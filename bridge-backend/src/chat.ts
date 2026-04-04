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
}

export type BackendChatResponse = {
  content: string
  model: string
  toolResults?: BackendChatToolResult[]
}

export type ChatCompletionClient = (request: BackendChatRequest) => Promise<BackendChatResponse>

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

async function requestOpenAICompletion(input: {
  apiKey: string
  model: string
  messages: OpenAIChatRequestMessage[]
  tools?: BackendChatToolDefinition[]
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
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI chat request failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  return (await response.json()) as OpenAIChatCompletionResponse
}

export function createOpenAIChatClient(): ChatCompletionClient {
  return async ({ messages, tools }) => {
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
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id || tool.name,
        content: JSON.stringify(result),
      })
    }

    const followupPayload = await requestOpenAICompletion({
      apiKey,
      model,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content:
            typeof assistantMessage?.content === 'string'
              ? assistantMessage.content
              : extractContent({ choices: [{ message: assistantMessage }] }),
          tool_calls: toolCalls,
        },
        ...toolMessages,
      ],
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
