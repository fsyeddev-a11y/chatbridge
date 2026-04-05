import type { ChatBridgeAppDefinition } from '@/packages/chatbridge/registry'

export type BridgeEnvelope = {
  source: 'chatbridge-app'
  version: '1.0'
  appId: string
  type: 'APP_READY' | 'STATE_UPDATE' | 'APP_COMPLETE' | 'APP_ERROR' | 'HEARTBEAT'
  payload?: {
    summary?: string
    state?: Record<string, unknown>
    error?: string
  }
}

export type HostBridgeEnvelope = {
  source: 'chatbridge-host'
  version: '1.0'
  appId: string
  type: 'INIT' | 'PING' | 'TERMINATE' | 'AUTH_RESULT'
  payload?: {
    sessionId?: string
    classId?: string
    locale?: string
    theme?: 'light' | 'dark'
    previousState?: Record<string, unknown>
    reason?: string
    success?: boolean
    provider?: string
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
      eventName: 'AppReadyReceived' | 'AppStateAccepted' | 'AppCompleted' | 'AppErrored' | 'AppHeartbeatReceived'
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

export function getHeartbeatTimeoutMs(app: ChatBridgeAppDefinition) {
  return app.heartbeatTimeoutMs || 10_000
}

export function getHeartbeatIntervalMs(app: ChatBridgeAppDefinition) {
  return Math.max(1_000, Math.floor(getHeartbeatTimeoutMs(app) / 2))
}

export function shouldSendHeartbeatPing(status: string | undefined) {
  return status === 'ready' || status === 'active'
}

export function getBridgeFailureMessage(reason: 'startup_timeout' | 'heartbeat_timeout') {
  if (reason === 'startup_timeout') {
    return 'The app stopped working before it finished loading. You can continue chatting or try reopening it.'
  }

  return 'The app stopped responding. You can continue chatting or try reopening it.'
}

export function resolveHostPostMessageTargetOrigin(app: ChatBridgeAppDefinition) {
  if (app.allowedOrigins.includes('null')) {
    return '*'
  }

  return app.allowedOrigins[0]
}

export function getIframeSandboxPolicy(app: ChatBridgeAppDefinition) {
  const basePolicy = ['allow-scripts', 'allow-forms', 'allow-popups']

  if (app.launchUrl) {
    return [...basePolicy, 'allow-same-origin'].join(' ')
  }

  return basePolicy.join(' ')
}

export function buildHostBridgeEnvelope(
  app: ChatBridgeAppDefinition,
  type: HostBridgeEnvelope['type'],
  payload?: HostBridgeEnvelope['payload']
): HostBridgeEnvelope {
  return {
    source: 'chatbridge-host',
    version: '1.0',
    appId: app.appId,
    type,
    payload,
  }
}

export function postHostBridgeMessage(
  iframe: Pick<HTMLIFrameElement, 'contentWindow'> | null | undefined,
  app: ChatBridgeAppDefinition,
  type: HostBridgeEnvelope['type'],
  payload?: HostBridgeEnvelope['payload']
) {
  const targetOrigin = resolveHostPostMessageTargetOrigin(app)
  if (!iframe?.contentWindow || !targetOrigin) {
    return {
      sent: false,
      targetOrigin,
      envelope: buildHostBridgeEnvelope(app, type, payload),
    }
  }

  const envelope = buildHostBridgeEnvelope(app, type, payload)
  iframe.contentWindow.postMessage(envelope, targetOrigin)

  return {
    sent: true,
    targetOrigin,
    envelope,
  }
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
    case 'HEARTBEAT':
      return {
        accepted: true,
        eventName: 'AppHeartbeatReceived',
        eventPayload: {
          messageType: data.type,
        },
        nextState: {},
      }
  }
}
