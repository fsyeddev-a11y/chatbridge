import type { ChatBridgeAppDefinition } from '@/packages/chatbridge/registry'

export type BridgeEnvelope = {
  source: 'chatbridge-app'
  version: '1.0'
  appId: string
  type: 'APP_READY' | 'STATE_UPDATE' | 'APP_COMPLETE' | 'APP_ERROR'
  payload?: {
    summary?: string
    state?: Record<string, unknown>
    error?: string
  }
}

export type BridgeMessageResolution =
  | {
      accepted: true
      nextState: {
        status?: 'idle' | 'ready' | 'active' | 'error' | 'complete'
        summary?: string
        lastState?: Record<string, unknown>
        lastError?: string
      }
      eventName: 'AppReadyReceived' | 'AppStateAccepted' | 'AppCompleted' | 'AppErrored'
      eventPayload?: {
        messageType: BridgeEnvelope['type']
        error?: string
      }
    }
  | {
      accepted: false
      reason: string
      eventPayload?: {
        messageType?: string
        error?: string
      }
    }

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (!value || typeof value !== 'object') {
    return false
  }
  const maybe = value as Record<string, unknown>
  return (
    maybe.source === 'chatbridge-app' &&
    maybe.version === '1.0' &&
    typeof maybe.appId === 'string' &&
    typeof maybe.type === 'string'
  )
}

export function isAllowedOrigin(origin: string, allowedOrigins: string[]) {
  return allowedOrigins.includes(origin)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function resolveBridgeEnvelope(
  activeApp: ChatBridgeAppDefinition,
  data: unknown,
  origin: string
): BridgeMessageResolution {
  if (!isBridgeEnvelope(data)) {
    return {
      accepted: false,
      reason: 'invalid_envelope',
    }
  }
  if (data.appId !== activeApp.appId) {
    return {
      accepted: false,
      reason: 'app_id_mismatch',
      eventPayload: {
        messageType: data.type,
      },
    }
  }
  if (!isAllowedOrigin(origin, activeApp.allowedOrigins)) {
    return {
      accepted: false,
      reason: 'disallowed_origin',
      eventPayload: {
        messageType: data.type,
      },
    }
  }

  switch (data.type) {
    case 'APP_READY':
      return {
        accepted: true,
        eventName: 'AppReadyReceived',
        eventPayload: {
          messageType: data.type,
        },
        nextState: {
          status: 'ready',
          summary: data.payload?.summary,
        },
      }
    case 'STATE_UPDATE':
      if (!isRecord(data.payload?.state)) {
        return {
          accepted: false,
          reason: 'invalid_state_payload',
          eventPayload: {
            messageType: data.type,
          },
        }
      }
      return {
        accepted: true,
        eventName: 'AppStateAccepted',
        eventPayload: {
          messageType: data.type,
        },
        nextState: {
          status: 'active',
          summary: data.payload?.summary,
          lastState: data.payload.state,
        },
      }
    case 'APP_COMPLETE':
      if (!isRecord(data.payload?.state)) {
        return {
          accepted: false,
          reason: 'invalid_completion_payload',
          eventPayload: {
            messageType: data.type,
          },
        }
      }
      return {
        accepted: true,
        eventName: 'AppCompleted',
        eventPayload: {
          messageType: data.type,
        },
        nextState: {
          status: 'complete',
          summary: data.payload?.summary,
          lastState: data.payload.state,
          lastError: undefined,
        },
      }
    case 'APP_ERROR':
      return {
        accepted: true,
        eventName: 'AppErrored',
        eventPayload: {
          messageType: data.type,
          error: data.payload?.error || 'Unknown app error',
        },
        nextState: {
          status: 'error',
          lastError: data.payload?.error || 'Unknown app error',
        },
      }
  }
}
