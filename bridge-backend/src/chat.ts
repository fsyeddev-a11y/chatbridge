export type BackendChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type BackendChatRequest = {
  messages: BackendChatMessage[]
}

export type BackendChatResponse = {
  content: string
  model: string
}

export type ChatCompletionClient = (request: BackendChatRequest) => Promise<BackendChatResponse>

type OpenAIChatCompletionChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>
  }
}

type OpenAIChatCompletionResponse = {
  choices?: OpenAIChatCompletionChoice[]
}

export function getBackendChatModel(envValue = process.env.CHATBRIDGE_OPENAI_MODEL) {
  return envValue?.trim() || 'gpt-4o-mini'
}

export function getOpenAIKey(envValue = process.env.OPENAI_API_KEY) {
  return envValue?.trim() || ''
}

function extractContent(payload: OpenAIChatCompletionResponse) {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim()
  }

  return ''
}

export function createOpenAIChatClient(): ChatCompletionClient {
  return async ({ messages }) => {
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured on bridge-backend')
    }

    const model = getBackendChatModel()
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`OpenAI chat request failed: ${response.status}${body ? ` ${body}` : ''}`)
    }

    const payload = (await response.json()) as OpenAIChatCompletionResponse
    const content = extractContent(payload)
    if (!content) {
      throw new Error('OpenAI chat request returned an empty response')
    }

    return {
      content,
      model,
    }
  }
}
