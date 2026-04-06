import type { AppRegistryEntry, BridgeAppContext, SessionBridgeState } from './types.js'
import type { BackendChatMessage } from './chat.js'

function formatSafeStateValue(value: unknown) {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

function pickLlmSafeState(entry: AppRegistryEntry, context: BridgeAppContext | undefined) {
  const state = context?.lastState
  if (!state || !entry.manifest.llmSafeFields.length) {
    return {}
  }

  return Object.fromEntries(
    entry.manifest.llmSafeFields
      .filter((field) => Object.prototype.hasOwnProperty.call(state, field))
      .map((field) => [field, state[field]])
  )
}

function getMostRecentClosedApp(input: {
  approvedApps: AppRegistryEntry[]
  bridgeState?: SessionBridgeState
}) {
  const appContext = input.bridgeState?.appContext || {}
  const closedEntries = Object.values(appContext)
    .filter((context) => context.status === 'closed')
    .sort((left, right) => (right.lastEventAt || 0) - (left.lastEventAt || 0))

  for (const entry of closedEntries) {
    const app = input.approvedApps.find((candidate) => candidate.manifest.appId === entry.appId)
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
  activeApp: AppRegistryEntry | undefined,
  approvedApps: AppRegistryEntry[],
  bridgeState: SessionBridgeState | undefined
) {
  if (!bridgeState?.activeAppId || !activeApp) {
    const mostRecentClosed = getMostRecentClosedApp({
      approvedApps,
      bridgeState,
    })
    if (mostRecentClosed) {
      return mostRecentClosed.context.summary
        ? `${mostRecentClosed.app.manifest.name} was closed by the user. Last safe state: ${mostRecentClosed.context.summary}.`
        : `${mostRecentClosed.app.manifest.name} was closed by the user.`
    }

    return 'No ChatBridge app is currently active.'
  }

  const activeContext = bridgeState.appContext[bridgeState.activeAppId]
  if (!activeContext) {
    return `${activeApp.manifest.name} is the active ChatBridge app.`
  }

  const safeState = pickLlmSafeState(activeApp, activeContext)
  const safeStateSummary = Object.entries(safeState)
    .map(([key, value]) => `${key}: ${formatSafeStateValue(value)}`)
    .join('; ')

  if (activeContext.status === 'error') {
    return safeStateSummary
      ? `${activeApp.manifest.name} previously failed. Last safe state: ${safeStateSummary}. Continue helping without relying on the app.`
      : `${activeApp.manifest.name} previously failed. Continue helping without relying on the app.`
  }

  if (activeContext.status === 'complete') {
    return safeStateSummary
      ? `${activeApp.manifest.name} completed its task. Last safe state: ${safeStateSummary}.`
      : `${activeApp.manifest.name} completed its task.`
  }

  if (activeContext.status === 'closed') {
    return activeContext.summary
      ? `${activeApp.manifest.name} was closed by the user. Last safe state: ${activeContext.summary}.`
      : `${activeApp.manifest.name} was closed by the user.`
  }

  if (safeStateSummary) {
    return `${activeApp.manifest.name} state: ${safeStateSummary}.`
  }

  return activeContext.summary || `${activeApp.manifest.name} is the active ChatBridge app.`
}

export function buildChatBridgeOrchestrationMessage(input: {
  classId?: string
  approvedApps: AppRegistryEntry[]
  bridgeState?: SessionBridgeState
}): BackendChatMessage {
  const activeApp = input.bridgeState?.activeAppId
    ? input.approvedApps.find((entry) => entry.manifest.appId === input.bridgeState?.activeAppId)
    : undefined
  const activeAppSummary = buildActiveAppSummary(activeApp, input.approvedApps, input.bridgeState)
  const approvedAppSummary = input.approvedApps.length
    ? input.approvedApps
        .map((entry) => {
          const toolList = entry.manifest.tools.length
            ? entry.manifest.tools.map((tool) => `${tool.name}: ${tool.description}`).join(' | ')
            : 'No model-visible tools.'
          return `- ${entry.manifest.name} (${entry.manifest.appId}, auth: ${entry.manifest.authType}): ${toolList}`
        })
        .join('\n')
    : '- No class-approved ChatBridge apps are currently available.'

  return {
    role: 'system',
    content: [
      'You are TutorMeAI operating inside ChatBridge.',
      'Respect backend-owned ChatBridge policy when answering.',
      input.classId ? `Active class: ${input.classId}` : 'Active class: unknown',
      `Active ChatBridge app summary: ${activeAppSummary}`,
      'Class-approved ChatBridge apps:',
      approvedAppSummary,
      'If an approved app would help, suggest that the student open it from the ChatBridge App Shelf.',
      'Do not claim you launched, resumed, or controlled a ChatBridge app unless the conversation already says it happened.',
      'Do not invent access to apps that are not listed as approved here.',
    ].join('\n'),
  }
}

export function prependChatBridgeOrchestrationMessage(
  messages: BackendChatMessage[],
  input: {
    classId?: string
    approvedApps: AppRegistryEntry[]
    bridgeState?: SessionBridgeState
  }
) {
  return [buildChatBridgeOrchestrationMessage(input), ...messages]
}
