import { trackEvent } from '@/utils/track'

type ChatBridgeEventName =
  | 'GenerationStarted'
  | 'ToolsetAssembled'
  | 'ChatBridgeToolInvoked'
  | 'GenerationCompleted'
  | 'AppInitSent'
  | 'AppPingSent'
  | 'AppTerminateSent'
  | 'AppStartupTimedOut'
  | 'AppHeartbeatTimedOut'
  | 'AppReadyReceived'
  | 'AppHeartbeatReceived'
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

const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'

function sanitizeEventPayload(payload: ChatBridgeEventPayload): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
}

export function emitChatBridgeEvent(event: ChatBridgeEvent) {
  const safePayload = sanitizeEventPayload(event.payload)
  trackEvent(`chatbridge_${event.name}`, safePayload)

  void fetch(`${CHATBRIDGE_API_ORIGIN}/api/audit/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timestamp: Date.now(),
      traceId: event.payload.traceId,
      eventType: event.name,
      source: 'frontend',
      sessionId: event.payload.sessionId,
      classId: event.payload.classId,
      appId: event.payload.appId,
      summary: event.payload.reason || event.payload.error,
      metadata: safePayload,
    }),
  }).catch((error) => {
    console.warn('Failed to send ChatBridge audit event', error)
  })
}
