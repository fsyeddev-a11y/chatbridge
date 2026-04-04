import { getMessageText } from '@shared/utils/message'
import type { Message } from '@shared/types'
import { getSupabaseAuthHeaders } from '@/packages/supabase'

const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'

export type BackendChatResult = {
  content: string
  model: string
}

export async function generateBackendChat(
  messages: Message[],
  options?: {
    sessionId?: string
    classId?: string
  }
): Promise<BackendChatResult> {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}/api/chat/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      sessionId: options?.sessionId,
      classId: options?.classId,
      messages: messages
        .map((message) => ({
          role: message.role,
          content: getMessageText(message, true, true).trim(),
        }))
        .filter((message) => message.role !== 'tool' && message.content),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ChatBridge backend chat request failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  return (await response.json()) as BackendChatResult
}
