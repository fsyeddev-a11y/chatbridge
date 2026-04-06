import { tool } from 'ai'
import z from 'zod'
import type { ToolSet } from 'ai'
import type { Session } from '@shared/types'
import { emitChatBridgeEvent } from '@/packages/chatbridge/observability'
import * as chatStore from '@/stores/chatStore'
import {
  type ChatBridgeAppDefinition,
  fetchApprovedChatBridgeAppsForClass,
  fetchChatBridgeAppById,
} from '@/packages/chatbridge/registry'
import { activateBridgeApp, getSessionBridgeState, updateBridgeAppContext } from '@/packages/chatbridge/session'

type ChatBridgeToolSet = {
  description: string
  tools: ToolSet
  availableToolNames: string[]
  activeAppId?: string
  activeClassId: string
  activeAppSummary?: string
}

function pickLlmSafeState(app: ChatBridgeAppDefinition, session: Session) {
  const bridgeState = getSessionBridgeState(session)
  const state = bridgeState.appContext[app.appId]?.lastState
  if (!state || !app.llmSafeFields?.length) {
    return {}
  }

  return Object.fromEntries(
    app.llmSafeFields
      .filter((field) => Object.prototype.hasOwnProperty.call(state, field))
      .map((field) => [field, state[field]])
  )
}

function getMostRecentClosedApp(session: Session, approvedApps: ChatBridgeAppDefinition[]) {
  const bridgeState = getSessionBridgeState(session)
  const closedEntries = Object.values(bridgeState.appContext)
    .filter((context) => context.status === 'closed')
    .sort((left, right) => (right.lastEventAt || 0) - (left.lastEventAt || 0))

  for (const entry of closedEntries) {
    const app = approvedApps.find((candidate) => candidate.appId === entry.appId)
    if (app) {
      return {
        app,
        context: entry,
      }
    }
  }

  return undefined
}

function buildActiveAppSummary(
  session: Session,
  approvedApps: ChatBridgeAppDefinition[],
  app: ChatBridgeAppDefinition | undefined
) {
  const bridgeState = getSessionBridgeState(session)
  if (!bridgeState.activeAppId || !app) {
    const mostRecentClosed = getMostRecentClosedApp(session, approvedApps)
    if (mostRecentClosed) {
      return mostRecentClosed.context.summary
        ? `${mostRecentClosed.app.name} was closed by the user. Last known state: ${mostRecentClosed.context.summary}`
        : `${mostRecentClosed.app.name} was closed by the user.`
    }

    return 'No ChatBridge app is active yet.'
  }

  const activeContext = bridgeState.appContext[bridgeState.activeAppId]
  if (!activeContext) {
    return `The active ChatBridge app is ${app.name}.`
  }

  const safeState = pickLlmSafeState(app, session)
  const safeStateEntries = Object.entries(safeState)
  const safeStateSummary = safeStateEntries.length
    ? safeStateEntries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('; ')
    : undefined
  const lastKnownState = activeContext.summary || safeStateSummary

  if (activeContext.status === 'error') {
    const errorReason = activeContext.lastError || `${app.name} is unavailable.`
    return lastKnownState
      ? `The ${app.name} app encountered an error and is no longer active. Last known state: ${lastKnownState}. Continue assisting the student without the app. Error: ${errorReason}`
      : `The ${app.name} app encountered an error and is no longer active. Continue assisting the student without the app. Error: ${errorReason}`
  }

  if (activeContext.status === 'complete') {
    return lastKnownState
      ? `${app.name} has completed its task. Last known state: ${lastKnownState}`
      : `${app.name} has completed its task.`
  }

  if (activeContext.status === 'closed') {
    return lastKnownState
      ? `${app.name} was closed by the user. Last known state: ${lastKnownState}`
      : `${app.name} was closed by the user.`
  }

  return (
    activeContext.summary ||
    app.llmSummaryTemplate ||
    (safeStateSummary ? `${app.name} state: ${safeStateSummary}` : `The active ChatBridge app is ${app.name}.`)
  )
}

function buildChatBridgeToolDescription(app: ChatBridgeAppDefinition, toolDescription: string) {
  const authNote = app.authType === 'oauth2' ? 'This app requires user authorization before protected data can be used.' : ''
  return `${toolDescription} Launches or resumes the "${app.name}" ChatBridge app inside TutorMeAI. ${authNote}`.trim()
}

function buildToolResult(app: ChatBridgeAppDefinition, toolName: string, session: Session, classId: string) {
  const bridgeState = getSessionBridgeState(session)
  const existingContext = bridgeState.appContext[app.appId]

  const summary =
    existingContext?.summary ||
    `${app.name} is now available in the ChatBridge panel. Ask the student to continue in the embedded app if more interaction is needed.`

  return {
    appId: app.appId,
    appName: app.name,
    toolName,
    status: 'opened',
    authType: app.authType,
    requiresAuthorization: app.authType === 'oauth2',
    summary,
    activeClassId: classId,
  }
}

function buildTool(
  app: ChatBridgeAppDefinition,
  toolName: string,
  toolDescription: string,
  sessionId: string,
  traceId?: string
) {
  return tool({
    description: buildChatBridgeToolDescription(app, toolDescription),
    inputSchema: z.object({}),
    execute: async () => {
      const session = await chatStore.getSession(sessionId)
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }

      const classId = getSessionBridgeState(session).activeClassId
      if (!classId) {
        throw new Error('ChatBridge tool execution requires an active entitled class.')
      }

      await activateBridgeApp(sessionId, app.appId)
      const result = buildToolResult(app, toolName, session, classId)
      await updateBridgeAppContext(sessionId, app.appId, {
        status: app.authType === 'oauth2' ? 'idle' : 'active',
        summary: result.summary,
        lastState: {
          invokedTool: toolName,
          requiresAuthorization: result.requiresAuthorization,
        },
      })
      emitChatBridgeEvent({
        name: 'ChatBridgeToolInvoked',
        payload: {
          traceId: traceId || 'chatbridge-trace-unknown',
          sessionId,
          classId: getSessionBridgeState(session).activeClassId,
          activeAppId: app.appId,
          appId: app.appId,
          toolName,
        },
      })
      return result
    },
  })
}

export async function getChatBridgeToolSet(
  sessionId: string,
  options?: { traceId?: string }
): Promise<ChatBridgeToolSet | null> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return null
  }

  const bridgeState = getSessionBridgeState(session)
  if (!bridgeState.activeClassId) {
    return null
  }

  let approvedApps: ChatBridgeAppDefinition[]
  try {
    approvedApps = await fetchApprovedChatBridgeAppsForClass(bridgeState.activeClassId)
  } catch {
    return null
  }

  if (!approvedApps.length) {
    return null
  }

  const tools: ToolSet = {}
  const availableToolNames: string[] = []

  for (const app of approvedApps) {
    for (const appTool of app.tools) {
      tools[appTool.name] = buildTool(app, appTool.name, appTool.description, sessionId, options?.traceId)
      availableToolNames.push(appTool.name)
    }
  }

  const activeApp = await fetchChatBridgeAppById(bridgeState.activeAppId)
  const activeSummary = buildActiveAppSummary(session, approvedApps, activeApp)

  const appDescriptions = approvedApps
    .map((app) => {
      const toolList = app.tools.map((item) => `- ${item.name}: ${item.description}`).join('\n')
      return `### ${app.name}\n- App ID: ${app.appId}\n- Auth: ${app.authType}\n${toolList}`
    })
    .join('\n\n')

  return {
    description: `
Use these ChatBridge tools only for class-approved third-party app requests inside TutorMeAI.

Current ChatBridge state:
- Active class: ${bridgeState.activeClassId}
- Active app summary: ${activeSummary}

Approved apps and tools:
${appDescriptions}
`,
    tools,
    availableToolNames,
    activeAppId: bridgeState.activeAppId,
    activeClassId: bridgeState.activeClassId,
    activeAppSummary: activeSummary,
  }
}
