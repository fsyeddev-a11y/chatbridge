import type { BackendChatToolDefinition, BackendChatToolResult } from './chat.js'
import type { BridgeStore } from './store.js'
import type { AppRegistryEntry, BridgeAppContext, SessionBridgeState } from './types.js'

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
        status: input.app.manifest.authType === 'oauth2' ? 'idle' : 'active',
        summary: buildToolSummary(input.app, existingContext),
        lastState: {
          ...(existingContext?.lastState || {}),
          invokedTool: input.toolName,
          requiresAuthorization: input.app.manifest.authType === 'oauth2',
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
}): BackendChatToolResult {
  const existingContext = input.bridgeState.appContext[input.app.manifest.appId]
  const summary = buildToolSummary(input.app, existingContext)

  return {
    appId: input.app.manifest.appId,
    appName: input.app.manifest.name,
    toolName: input.toolName,
    status: 'opened',
    authType: input.app.manifest.authType,
    requiresAuthorization: input.app.manifest.authType === 'oauth2',
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
}): Promise<BackendChatToolDefinition[]> {
  if (!input.sessionId || !input.userId || !input.classId) {
    return []
  }

  return input.approvedApps.flatMap((app) =>
    app.manifest.tools.map((tool) => ({
      name: tool.name,
      description: `${tool.description} Launches or resumes the "${app.manifest.name}" ChatBridge app inside TutorMeAI.`,
      execute: async () => {
        const updatedBridgeState = nextBridgeState({
          app,
          bridgeState: input.bridgeState,
          classId: input.classId!,
          toolName: tool.name,
        })
        const record = await input.store.upsertBridgeSessionState(input.sessionId!, input.userId!, updatedBridgeState)
        const result = buildToolResult({
          app,
          classId: input.classId!,
          toolName: tool.name,
          bridgeState: record.bridgeState,
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
