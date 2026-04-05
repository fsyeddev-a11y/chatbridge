import { getMessageText } from '@shared/utils/message'
import type { Message } from '@shared/types'
import type { SessionBridgeState } from '@shared/types'
import { getSupabaseAuthHeaders } from '@/packages/supabase'

const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'

export type BackendChatResult = {
  content: string
  model: string
  bridgeState?: SessionBridgeState
}

type BackendChatStreamEvent =
  | {
      type: 'started'
      model: string
      traceId?: string
    }
  | {
      type: 'delta'
      delta: string
    }
  | {
      type: 'tool_result'
      toolResult: Record<string, unknown>
    }
  | {
      type: 'completed'
      content: string
      model: string
      bridgeState?: SessionBridgeState
      traceId?: string
    }
  | {
      type: 'error'
      error: string
      traceId?: string
    }

type StreamHandlers = {
  onStarted?: (event: { model: string; traceId?: string }) => void
  onDelta?: (delta: string) => void
  onCompleted?: (result: BackendChatResult & { traceId?: string }) => void
  onError?: (event: { error: string; traceId?: string }) => void
}

function buildBackendChatPayload(
  messages: Message[],
  options?: {
    sessionId?: string
    classId?: string
  }
) {
  return {
    sessionId: options?.sessionId,
    classId: options?.classId,
    messages: messages
      .map((message) => ({
        role: message.role,
        content: getMessageText(message, true, true).trim(),
      }))
      .filter((message) => message.role !== 'tool' && message.content),
  }
}

async function getBackendChatResponse(
  path: string,
  messages: Message[],
  options?: {
    sessionId?: string
    classId?: string
    signal?: AbortSignal
  }
) {
  const authHeaders = await getSupabaseAuthHeaders()
  return fetch(`${CHATBRIDGE_API_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(buildBackendChatPayload(messages, options)),
    signal: options?.signal,
  })
}

export async function generateBackendChat(
  messages: Message[],
  options?: {
    sessionId?: string
    classId?: string
    signal?: AbortSignal
  }
): Promise<BackendChatResult> {
  const response = await getBackendChatResponse('/api/chat/generate', messages, options)

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ChatBridge backend chat request failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  return (await response.json()) as BackendChatResult
}

export async function streamBackendChat(
  messages: Message[],
  handlers: StreamHandlers,
  options?: {
    sessionId?: string
    classId?: string
    signal?: AbortSignal
  }
): Promise<BackendChatResult> {
  const response = await getBackendChatResponse('/api/chat/stream', messages, options)

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ChatBridge backend stream request failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  if (!response.body) {
    throw new Error('ChatBridge backend stream response did not include a body')
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''
  let eventName = 'message'
  let aggregatedContent = ''
  let finalResult: BackendChatResult | null = null

  const flushEvent = (rawEvent: string) => {
    const lines = rawEvent.split('\n').map((line) => line.trimEnd())
    const eventLine = lines.find((line) => line.startsWith('event:'))
    const dataLine = lines.find((line) => line.startsWith('data:'))
    if (!dataLine) {
      return
    }

    eventName = eventLine ? eventLine.slice('event:'.length).trim() : 'message'
    const data = dataLine.slice('data:'.length).trim()
    if (!data) {
      return
    }

    const payload = JSON.parse(data) as Record<string, unknown>
    let parsedEvent: BackendChatStreamEvent | null = null

    if (eventName === 'started' && typeof payload.model === 'string') {
      parsedEvent = {
        type: 'started',
        model: payload.model,
        traceId: typeof payload.traceId === 'string' ? payload.traceId : undefined,
      }
    } else if (eventName === 'delta' && typeof payload.delta === 'string') {
      parsedEvent = {
        type: 'delta',
        delta: payload.delta,
      }
    } else if (eventName === 'tool_result' && payload.toolResult && typeof payload.toolResult === 'object') {
      parsedEvent = {
        type: 'tool_result',
        toolResult: payload.toolResult as Record<string, unknown>,
      }
    } else if (eventName === 'completed' && typeof payload.content === 'string' && typeof payload.model === 'string') {
      parsedEvent = {
        type: 'completed',
        content: payload.content,
        model: payload.model,
        bridgeState: payload.bridgeState as SessionBridgeState | undefined,
        traceId: typeof payload.traceId === 'string' ? payload.traceId : undefined,
      }
    } else if (eventName === 'error' && typeof payload.error === 'string') {
      parsedEvent = {
        type: 'error',
        error: payload.error,
        traceId: typeof payload.traceId === 'string' ? payload.traceId : undefined,
      }
    }

    if (!parsedEvent) {
      return
    }

    if (parsedEvent.type === 'started') {
      handlers.onStarted?.({
        model: parsedEvent.model,
        traceId: parsedEvent.traceId,
      })
      return
    }

    if (parsedEvent.type === 'delta') {
      aggregatedContent += parsedEvent.delta
      handlers.onDelta?.(parsedEvent.delta)
      return
    }

    if (parsedEvent.type === 'completed') {
      finalResult = {
        content: parsedEvent.content,
        model: parsedEvent.model,
        bridgeState: parsedEvent.bridgeState,
      }
      handlers.onCompleted?.({
        ...finalResult,
        traceId: parsedEvent.traceId,
      })
      return
    }

    if (parsedEvent.type === 'error') {
      handlers.onError?.({
        error: parsedEvent.error,
        traceId: parsedEvent.traceId,
      })
      throw new Error(parsedEvent.error)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const separatorIndex = buffer.indexOf('\n\n')
      if (separatorIndex === -1) {
        break
      }

      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      flushEvent(rawEvent)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    flushEvent(buffer.trim())
  }

  if (finalResult) {
    return finalResult
  }

  if (!aggregatedContent) {
    throw new Error('ChatBridge backend stream ended without a completion payload')
  }

  return {
    content: aggregatedContent,
    model: process.env.CHATBRIDGE_DEFAULT_MODEL || 'gpt-4o-mini',
  }
}
