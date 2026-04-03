import { trackEvent } from '@/utils/track'

type ChatBridgeEventName =
  | 'GenerationStarted'
  | 'ToolsetAssembled'
  | 'ChatBridgeToolInvoked'
  | 'GenerationCompleted'
  | 'AppReadyReceived'
  | 'AppStateAccepted'
  | 'AppStateRejected'
  | 'AppCompleted'
  | 'AppErrored'
  | 'AppClosed'

type ChatBridgeEventPayload = {
  traceId: string
  sessionId?: string
  classId?: string
  activeAppId?: string
  appId?: string
  toolName?: string
  provider?: string
  model?: string
  finishReason?: string
  availableToolNames?: string[]
  invokedToolNames?: string[]
  reason?: string
  error?: string
  messageType?: string
}

export type ChatBridgeEvent = {
  name: ChatBridgeEventName
  payload: ChatBridgeEventPayload
}

function sanitizeEventPayload(payload: ChatBridgeEventPayload): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
}

export function emitChatBridgeEvent(event: ChatBridgeEvent) {
  const safePayload = sanitizeEventPayload(event.payload)
  trackEvent(`chatbridge_${event.name}`, safePayload)
}
