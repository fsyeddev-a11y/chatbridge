import { tool } from 'ai'
import z from 'zod'
import type { ToolSet } from 'ai'
import type { Session } from '@shared/types'
import { emitChatBridgeEvent } from '@/packages/chatbridge/observability'
import * as chatStore from '@/stores/chatStore'
import {
  type ChatBridgeAppDefinition,
  getApprovedChatBridgeAppsForClass,
  getChatBridgeAppById,
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

function buildActiveAppSummary(session: Session, app: ChatBridgeAppDefinition | undefined) {
  const bridgeState = getSessionBridgeState(session)
  if (!bridgeState.activeAppId || !app) {
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

function buildToolResult(app: ChatBridgeAppDefinition, toolName: string, session: Session) {
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
    activeClassId: bridgeState.activeClassId,
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

      await activateBridgeApp(sessionId, app.appId)
      const result = buildToolResult(app, toolName, session)
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
  const approvedApps = getApprovedChatBridgeAppsForClass(bridgeState.activeClassId)
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

  const activeApp = getChatBridgeAppById(bridgeState.activeAppId)
  const activeSummary = buildActiveAppSummary(session, activeApp)

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
