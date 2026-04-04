export type BackendChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type BackendChatToolResult = {
  appId: string
  appName: string
  toolName: string
  status: 'opened'
  authType: 'none' | 'api-key' | 'oauth2'
  requiresAuthorization: boolean
  summary: string
  activeClassId: string
}

export type BackendChatToolDefinition = {
  name: string
  description: string
  execute: () => Promise<BackendChatToolResult>
}

export type BackendChatRequest = {
  messages: BackendChatMessage[]
  tools?: BackendChatToolDefinition[]
  signal?: AbortSignal
}

export type BackendChatResponse = {
  content: string
  model: string
  toolResults?: BackendChatToolResult[]
}

export type BackendChatStreamHandlers = {
  onStart?: (event: { model: string }) => void
  onTextDelta?: (delta: string) => void
  onToolResult?: (result: BackendChatToolResult) => void
}

export type ChatCompletionClient = (request: BackendChatRequest) => Promise<BackendChatResponse>
export type ChatCompletionStreamClient = (
  request: BackendChatRequest,
  handlers?: BackendChatStreamHandlers
) => Promise<BackendChatResponse>

type OpenAIChatCompletionChoice = {
  message?: {
    role?: string
    content?: string | Array<{ type?: string; text?: string }>
    tool_calls?: OpenAIChatToolCall[]
  }
}

type OpenAIChatCompletionResponse = {
  choices?: OpenAIChatCompletionChoice[]
}

type OpenAIChatToolCall = {
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

type OpenAIChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
}

type OpenAIChatRequestMessage =
  | BackendChatMessage
  | {
      role: 'assistant'
      content: string
      tool_calls: OpenAIChatToolCall[]
    }
  | {
      role: 'tool'
      tool_call_id: string
      content: string
    }

type StreamedOpenAIResponse = {
  content: string
  toolCalls: OpenAIChatToolCall[]
}

export function getBackendChatModel(envValue = process.env.CHATBRIDGE_OPENAI_MODEL) {
  return envValue?.trim() || 'gpt-4o-mini'
}

export function getOpenAIKey(envValue = process.env.OPENAI_API_KEY) {
  return envValue?.trim() || ''
}

function normalizeContentPart(content: string | Array<{ type?: string; text?: string }> | undefined) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
  }

  return ''
}

function extractContent(payload: OpenAIChatCompletionResponse) {
  return normalizeContentPart(payload.choices?.[0]?.message?.content).trim()
}

async function requestOpenAICompletion(input: {
  apiKey: string
  model: string
  messages: OpenAIChatRequestMessage[]
  tools?: BackendChatToolDefinition[]
  signal?: AbortSignal
}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      tools: input.tools?.length
        ? input.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
            },
          }))
        : undefined,
      tool_choice: input.tools?.length ? 'auto' : undefined,
    }),
    signal: input.signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI chat request failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  return (await response.json()) as OpenAIChatCompletionResponse
}

async function requestOpenAICompletionStream(input: {
  apiKey: string
  model: string
  messages: OpenAIChatRequestMessage[]
  tools?: BackendChatToolDefinition[]
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: input.messages,
      tools: input.tools?.length
        ? input.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
            },
          }))
        : undefined,
      tool_choice: input.tools?.length ? 'auto' : undefined,
    }),
    signal: input.signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI chat stream request failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  if (!response.body) {
    throw new Error('OpenAI chat stream response did not include a body')
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''
  let content = ''
  const toolCallsByIndex = new Map<number, OpenAIChatToolCall>()

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
      const dataLines = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))

      for (const line of dataLines) {
        const data = line.slice('data:'.length).trim()
        if (!data) {
          continue
        }

        if (data === '[DONE]') {
          continue
        }

        const chunk = JSON.parse(data) as OpenAIChatCompletionChunk
        const choice = chunk.choices?.[0]
        const delta = choice?.delta

        const contentDelta = normalizeContentPart(delta?.content)
        if (contentDelta) {
          content += contentDelta
          input.onTextDelta?.(contentDelta)
        }

        for (const partialToolCall of delta?.tool_calls || []) {
          const index = partialToolCall.index ?? 0
          const current = toolCallsByIndex.get(index) || {
            id: '',
            type: 'function',
            function: {
              name: '',
              arguments: '',
            },
          }

          toolCallsByIndex.set(index, {
            id: partialToolCall.id || current.id,
            type: partialToolCall.type || current.type,
            function: {
              name: `${current.function?.name || ''}${partialToolCall.function?.name || ''}`,
              arguments: `${current.function?.arguments || ''}${partialToolCall.function?.arguments || ''}`,
            },
          })
        }
      }
    }
  }

  buffer += decoder.decode()

  return {
    content: content.trim(),
    toolCalls: Array.from(toolCallsByIndex.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, value]) => value),
  } satisfies StreamedOpenAIResponse
}

async function executeToolCalls(
  toolCalls: OpenAIChatToolCall[],
  tools?: BackendChatToolDefinition[],
  onToolResult?: (result: BackendChatToolResult) => void
) {
  const availableTools = new Map((tools || []).map((tool) => [tool.name, tool]))
  const toolResults: BackendChatToolResult[] = []
  const toolMessages: OpenAIChatRequestMessage[] = []

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function?.name
    const tool = toolName ? availableTools.get(toolName) : undefined
    if (!tool) {
      continue
    }

    const result = await tool.execute()
    toolResults.push(result)
    onToolResult?.(result)
    toolMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id || tool.name,
      content: JSON.stringify(result),
    })
  }

  return {
    toolResults,
    toolMessages,
  }
}

function createAssistantToolCallMessage(
  assistantMessage: OpenAIChatCompletionChoice['message'] | undefined,
  toolCalls: OpenAIChatToolCall[]
): OpenAIChatRequestMessage {
  return {
    role: 'assistant',
    content: normalizeContentPart(assistantMessage?.content).trim(),
    tool_calls: toolCalls,
  }
}

export function createOpenAIChatClient(): ChatCompletionClient {
  return async ({ messages, tools, signal }) => {
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured on bridge-backend')
    }

    const model = getBackendChatModel()
    const initialPayload = await requestOpenAICompletion({
      apiKey,
      model,
      messages,
      tools,
      signal,
    })
    const assistantMessage = initialPayload.choices?.[0]?.message
    const toolCalls = assistantMessage?.tool_calls || []

    if (!toolCalls.length) {
      const content = extractContent(initialPayload)
      if (!content) {
        throw new Error('OpenAI chat request returned an empty response')
      }

      return {
        content,
        model,
      }
    }

    const { toolResults, toolMessages } = await executeToolCalls(toolCalls, tools)

    const followupPayload = await requestOpenAICompletion({
      apiKey,
      model,
      messages: [...messages, createAssistantToolCallMessage(assistantMessage, toolCalls), ...toolMessages],
      signal,
    })
    const content = extractContent(followupPayload)
    if (!content) {
      throw new Error('OpenAI chat request returned an empty response')
    }

    return {
      content,
      model,
      toolResults,
    }
  }
}

export function createOpenAIChatStreamClient(): ChatCompletionStreamClient {
  return async ({ messages, tools, signal }, handlers = {}) => {
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured on bridge-backend')
    }

    const model = getBackendChatModel()
    handlers.onStart?.({ model })

    const initialStream = await requestOpenAICompletionStream({
      apiKey,
      model,
      messages,
      tools,
      signal,
      onTextDelta: handlers.onTextDelta,
    })

    if (!initialStream.toolCalls.length) {
      if (!initialStream.content) {
        throw new Error('OpenAI chat stream returned an empty response')
      }

      return {
        content: initialStream.content,
        model,
      }
    }

    const { toolResults, toolMessages } = await executeToolCalls(initialStream.toolCalls, tools, handlers.onToolResult)
    const followupStream = await requestOpenAICompletionStream({
      apiKey,
      model,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: initialStream.content,
          tool_calls: initialStream.toolCalls,
        },
        ...toolMessages,
      ],
      signal,
      onTextDelta: handlers.onTextDelta,
    })

    if (!followupStream.content) {
      throw new Error('OpenAI chat stream returned an empty response')
    }

    return {
      content: followupStream.content,
      model,
      toolResults,
    }
  }
}
