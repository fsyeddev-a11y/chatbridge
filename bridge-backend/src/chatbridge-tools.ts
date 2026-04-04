import type { BackendChatToolDefinition, BackendChatToolResult } from './chat.js'
import type { BridgeStore } from './store.js'
import type { RateLimiter } from './rate-limit.js'
import type { AppRegistryEntry, BridgeAppContext, SessionBridgeState } from './types.js'

export class ChatBridgeToolPolicyError extends Error {
  statusCode: number
  errorCode: 'rate_limited' | 'policy_denied'
  metadata?: Record<string, unknown>

  constructor(
    message: string,
    input: {
      statusCode: number
      errorCode: 'rate_limited' | 'policy_denied'
      metadata?: Record<string, unknown>
    }
  ) {
    super(message)
    this.name = 'ChatBridgeToolPolicyError'
    this.statusCode = input.statusCode
    this.errorCode = input.errorCode
    this.metadata = input.metadata
  }
}

function buildToolSummary(app: AppRegistryEntry, existingContext: BridgeAppContext | undefined) {
  return (
    existingContext?.summary ||
    `${app.manifest.name} is now available in the ChatBridge panel. Ask the student to continue in the embedded app if more interaction is needed.`
  )
}

function nextBridgeState(input: {
  app: AppRegistryEntry
  bridgeState?: SessionBridgeState
  classId: string
  toolName: string
  isAuthorized: boolean
}): SessionBridgeState {
  const previousState = input.bridgeState || {
    activeClassId: input.classId,
    appContext: {},
  }
  const existingContext = previousState.appContext[input.app.manifest.appId]

  return {
    ...previousState,
    activeClassId: input.classId,
    activeAppId: input.app.manifest.appId,
    appContext: {
      ...previousState.appContext,
      [input.app.manifest.appId]: {
        appId: input.app.manifest.appId,
        status: input.app.manifest.authType === 'oauth2' && !input.isAuthorized ? 'idle' : 'active',
        summary: buildToolSummary(input.app, existingContext),
        lastState: {
          ...(existingContext?.lastState || {}),
          invokedTool: input.toolName,
          requiresAuthorization: input.app.manifest.authType === 'oauth2' && !input.isAuthorized,
        },
        lastEventAt: Date.now(),
        lastError: undefined,
      },
    },
  }
}

function buildToolResult(input: {
  app: AppRegistryEntry
  classId: string
  toolName: string
  bridgeState: SessionBridgeState
  isAuthorized: boolean
}): BackendChatToolResult {
  const existingContext = input.bridgeState.appContext[input.app.manifest.appId]
  const summary = buildToolSummary(input.app, existingContext)

  return {
    appId: input.app.manifest.appId,
    appName: input.app.manifest.name,
    toolName: input.toolName,
    status: 'opened',
    authType: input.app.manifest.authType,
    requiresAuthorization: input.app.manifest.authType === 'oauth2' && !input.isAuthorized,
    summary,
    activeClassId: input.classId,
  }
}

export async function createChatBridgeToolDefinitions(input: {
  approvedApps: AppRegistryEntry[]
  store: BridgeStore
  sessionId?: string
  userId?: string
  classId?: string
  bridgeState?: SessionBridgeState
  traceId: string
  toolRateLimiter?: RateLimiter | null
}): Promise<BackendChatToolDefinition[]> {
  if (!input.sessionId || !input.userId || !input.classId) {
    return []
  }

  return input.approvedApps.flatMap((app) =>
    app.manifest.tools.map((tool) => ({
      name: tool.name,
      description: `${tool.description} Launches or resumes the "${app.manifest.name}" ChatBridge app inside TutorMeAI.`,
      execute: async () => {
        if (input.toolRateLimiter) {
          const rateLimitResult = input.toolRateLimiter.check(`tool:${input.userId}:${app.manifest.appId}`)
          if (!rateLimitResult.allowed) {
            const retryAfterMs = Math.max(0, rateLimitResult.resetAt - Date.now())
            await input.store.appendAuditEvent({
              timestamp: Date.now(),
              traceId: input.traceId,
              eventType: 'ToolRateLimitExceeded',
              source: 'bridge-backend',
              sessionId: input.sessionId,
              classId: input.classId,
              appId: app.manifest.appId,
              appVersion: app.manifest.version,
              summary: `Backend denied ${tool.name} due to tool rate limiting.`,
              metadata: {
                toolName: tool.name,
                retryAfterMs,
                scope: 'per_user_per_app',
              },
            })

            throw new ChatBridgeToolPolicyError(`${tool.name} is temporarily rate limited.`, {
              statusCode: 429,
              errorCode: 'rate_limited',
              metadata: {
                scope: `tool:${app.manifest.appId}`,
                retryAfterMs,
              },
            })
          }
        }

        const isAuthorized =
          app.manifest.authType === 'oauth2' && app.manifest.oauthProvider
            ? Boolean(await input.store.getOAuthToken(input.userId!, app.manifest.appId, app.manifest.oauthProvider))
            : true

        const updatedBridgeState = nextBridgeState({
          app,
          bridgeState: input.bridgeState,
          classId: input.classId!,
          toolName: tool.name,
          isAuthorized,
        })
        const record = await input.store.upsertBridgeSessionState(input.sessionId!, input.userId!, updatedBridgeState)
        const result = buildToolResult({
          app,
          classId: input.classId!,
          toolName: tool.name,
          bridgeState: record.bridgeState,
          isAuthorized,
        })

        await input.store.appendAuditEvent({
          timestamp: Date.now(),
          traceId: input.traceId,
          eventType: 'ChatBridgeToolInvoked',
          source: 'bridge-backend',
          sessionId: input.sessionId,
          classId: input.classId,
          appId: app.manifest.appId,
          appVersion: app.manifest.version,
          summary: `Backend opened ${app.manifest.name} through ${tool.name}.`,
          metadata: {
            toolName: tool.name,
            requiresAuthorization: result.requiresAuthorization,
          },
        })

        return result
      },
    }))
  )
}
