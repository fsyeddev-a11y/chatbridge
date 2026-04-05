import type { BridgeAppManifest } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { getSupabaseAuthHeaders, useSupabaseAuthState } from '@/packages/supabase'
import queryClient from '@/stores/queryClient'

export type ChatBridgeAppDefinition = BridgeAppManifest & {
  reviewState: 'approved' | 'pending' | 'rejected' | 'suspended'
  enabledClassIds: string[]
  llmOwnership: 'platform'
  mockMode?: 'chess' | 'weather' | 'classroom'
  ownerUserId?: string
  ownerEmail?: string
  reviewNotes?: string
  reviewedAt?: number
  registeredAt?: number
  activeVersion?: string
  pendingVersion?: string
}

export type ChatBridgeAllowlistEntry = {
  classId: string
  appId: string
  enabledBy: string
  enabledAt: number
  disabledAt?: number
}

export type ChatBridgeReviewAction = {
  appId: string
  version: string
  action: 'approve' | 'reject' | 'suspend' | 'request_changes'
  reviewerId: string
  notes?: string
  timestamp: number
}

type RegistryApiResponse = {
  apps: Array<{
    manifest: BridgeAppManifest
    reviewState: ChatBridgeAppDefinition['reviewState']
    ownerUserId?: string
    ownerEmail?: string
    reviewNotes?: string
    reviewedAt?: number
    registeredAt?: number
    activeVersion?: string
    pendingVersion?: string
  }>
}

type ClassAppsApiResponse = {
  classId: string
  apps: Array<{
    manifest: BridgeAppManifest
    reviewState: ChatBridgeAppDefinition['reviewState']
  }>
}

type ClassAllowlistApiResponse = {
  classId: string
  allowlist: ChatBridgeAllowlistEntry[]
}

type RegistryAppResponse = {
  app: {
    manifest: BridgeAppManifest
    reviewState: ChatBridgeAppDefinition['reviewState']
    ownerUserId?: string
    ownerEmail?: string
    reviewNotes?: string
    reviewedAt?: number
    registeredAt?: number
    activeVersion?: string
    pendingVersion?: string
  }
}

type ReviewActionsApiResponse = {
  actions: ChatBridgeReviewAction[]
}

const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'
const CHATBRIDGE_WEATHER_APP_URL = process.env.CHATBRIDGE_WEATHER_APP_URL || 'http://localhost:4173'
const CHATBRIDGE_WEATHER_APP_ORIGIN = (() => {
  try {
    return new URL(CHATBRIDGE_WEATHER_APP_URL).origin
  } catch {
    return 'http://localhost:4173'
  }
})()

const fallbackRegistry: ChatBridgeAppDefinition[] = [
  {
    appId: 'chess',
    name: 'Chess Coach',
    version: '1.0.0',
    description: 'Interactive chess board with guided state updates for in-chat coaching.',
    developerName: 'ChatBridge Demo',
    executionModel: 'iframe',
    allowedOrigins: ['null'],
    authType: 'none',
    subjectTags: ['Strategy', 'Logic'],
    gradeBand: '3-12',
    llmSafeFields: ['phase', 'fen'],
    reviewState: 'approved',
    enabledClassIds: ['demo-class'],
    llmOwnership: 'platform',
    mockMode: 'chess',
    tools: [
      {
        name: 'chatbridge_chess_start_game',
        description: 'Start a new chess game for the current student.',
      },
      {
        name: 'chatbridge_chess_get_hint',
        description: 'Get a tutoring hint for the current board position.',
      },
    ],
  },
  {
    appId: 'weather',
    name: 'Weather Dashboard',
    version: '1.0.0',
    description: 'Lightweight public weather app for quick lookups and contextual summaries.',
    developerName: 'ChatBridge Demo',
    executionModel: 'iframe',
    launchUrl: CHATBRIDGE_WEATHER_APP_URL,
    allowedOrigins: [CHATBRIDGE_WEATHER_APP_ORIGIN],
    authType: 'none',
    subjectTags: ['Science'],
    gradeBand: 'K-12',
    llmSafeFields: ['location', 'conditions', 'temperatureF'],
    reviewState: 'approved',
    enabledClassIds: ['demo-class'],
    llmOwnership: 'platform',
    tools: [
      {
        name: 'chatbridge_weather_lookup',
        description: 'Look up current weather for a student-selected location.',
      },
    ],
  },
  {
    appId: 'google-classroom',
    name: 'Google Classroom Assistant',
    version: '1.0.0',
    description: 'Read-only classroom context for due dates, coursework, and tutoring follow-ups.',
    developerName: 'ChatBridge Demo',
    executionModel: 'iframe',
    allowedOrigins: ['null'],
    authType: 'oauth2',
    oauthProvider: 'google',
    oauthScopes: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    ],
    subjectTags: ['Productivity', 'Classroom'],
    gradeBand: '3-12',
    llmSafeFields: ['courseCount', 'upcomingAssignments'],
    reviewState: 'approved',
    enabledClassIds: ['demo-class'],
    llmOwnership: 'platform',
    mockMode: 'classroom',
    tools: [
      {
        name: 'chatbridge_google_classroom_overview',
        description: 'Retrieve a read-only summary of the student classroom workload.',
      },
    ],
  },
]

const mockModeByAppId: Record<string, ChatBridgeAppDefinition['mockMode']> = {
  chess: 'chess',
  weather: 'weather',
  'google-classroom': 'classroom',
}

export const ChatBridgeQueryKeys = {
  ChatBridgeApps: ['chatbridge', 'apps'],
  ChatBridgeDeveloperApps: ['chatbridge', 'developer-apps'],
  ChatBridgeDeveloperReviewActions: ['chatbridge', 'developer-review-actions'],
  ChatBridgeClassApps: (classId: string) => ['chatbridge', 'class-apps', classId],
  ChatBridgeClassAllowlist: (classId: string) => ['chatbridge', 'class-allowlist', classId],
  ChatBridgeReviewActions: ['chatbridge', 'review-actions'],
}

function getFallbackRegistry() {
  return fallbackRegistry
}

function getFallbackAppById(appId: string | undefined) {
  if (!appId) {
    return undefined
  }
  return getFallbackRegistry().find((app) => app.appId === appId)
}

function augmentAppDefinition(
  app: Omit<ChatBridgeAppDefinition, 'enabledClassIds' | 'llmOwnership'> &
    Partial<Pick<ChatBridgeAppDefinition, 'enabledClassIds' | 'llmOwnership' | 'mockMode'>>
): ChatBridgeAppDefinition {
  const fallback = getFallbackAppById(app.appId)
  const shouldAllowSrcDocFallback = !app.launchUrl && (fallback?.allowedOrigins || []).includes('null')
  const allowedOrigins = Array.from(
    new Set([...(app.allowedOrigins || []), ...(shouldAllowSrcDocFallback ? ['null'] : [])])
  )

  return {
    ...app,
    allowedOrigins,
    enabledClassIds: app.enabledClassIds || fallback?.enabledClassIds || [],
    llmOwnership: app.llmOwnership || 'platform',
    mockMode: app.mockMode || mockModeByAppId[app.appId] || fallback?.mockMode,
  }
}

function normalizeRegistryEntries(entries: RegistryApiResponse['apps']): ChatBridgeAppDefinition[] {
  return entries.map((entry) =>
    augmentAppDefinition({
      ...entry.manifest,
      reviewState: entry.reviewState,
      ownerUserId: entry.ownerUserId,
      ownerEmail: entry.ownerEmail,
      reviewNotes: entry.reviewNotes,
      reviewedAt: entry.reviewedAt,
      registeredAt: entry.registeredAt,
      activeVersion: entry.activeVersion,
      pendingVersion: entry.pendingVersion,
    })
  )
}

async function fetchJson<T>(path: string): Promise<T> {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}${path}`, {
    headers: {
      ...authHeaders,
    },
  })

  if (!response.ok) {
    throw new Error(`ChatBridge backend request failed: ${response.status}`)
  }
  return (await response.json()) as T
}

async function sendJson<T>(path: string, method: 'POST', body: Record<string, unknown>): Promise<T> {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`ChatBridge backend request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

async function invalidateChatBridgeQueries(classId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['chatbridge'] }),
    queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperApps }),
    queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperReviewActions }),
    classId ? queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeClassApps(classId) }) : Promise.resolve(),
    classId
      ? queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeClassAllowlist(classId) })
      : Promise.resolve(),
  ])
}

export async function fetchChatBridgeApps(): Promise<ChatBridgeAppDefinition[]> {
  const response = await fetchJson<RegistryApiResponse>('/api/registry/apps')
  return normalizeRegistryEntries(response.apps)
}

export async function fetchApprovedChatBridgeAppsForClass(classId: string): Promise<ChatBridgeAppDefinition[]> {
  const response = await fetchJson<ClassAppsApiResponse>(`/api/classes/${classId}/apps`)
  return normalizeRegistryEntries(response.apps)
}

export async function fetchChatBridgeAppById(appId: string | undefined): Promise<ChatBridgeAppDefinition | undefined> {
  if (!appId) {
    return undefined
  }

  try {
    const allApps = await queryClient.ensureQueryData({
      queryKey: ChatBridgeQueryKeys.ChatBridgeApps,
      queryFn: fetchChatBridgeApps,
      staleTime: 30_000,
    })
    return allApps.find((app) => app.appId === appId)
  } catch {
    return undefined
  }
}

export function useChatBridgeApps() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeApps,
    queryFn: fetchChatBridgeApps,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export async function fetchDeveloperChatBridgeApps(): Promise<ChatBridgeAppDefinition[]> {
  const response = await fetchJson<RegistryApiResponse>('/api/developer/apps')
  return normalizeRegistryEntries(response.apps)
}

export function useDeveloperChatBridgeApps() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperApps,
    queryFn: fetchDeveloperChatBridgeApps,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export async function fetchDeveloperChatBridgeReviewActions(): Promise<ChatBridgeReviewAction[]> {
  const response = await fetchJson<ReviewActionsApiResponse>('/api/developer/review-actions')
  return response.actions
}

export function useDeveloperChatBridgeReviewActions() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperReviewActions,
    queryFn: fetchDeveloperChatBridgeReviewActions,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export function useApprovedChatBridgeAppsForClass(classId: string) {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeClassApps(classId),
    queryFn: () => fetchApprovedChatBridgeAppsForClass(classId),
    staleTime: 30_000,
    enabled: !!classId && !loading && isAuthenticated,
  })
}

export async function fetchChatBridgeAllowlist(classId: string): Promise<ChatBridgeAllowlistEntry[]> {
  const response = await fetchJson<ClassAllowlistApiResponse>(`/api/classes/${classId}/allowlist`)
  return response.allowlist
}

export function useChatBridgeAllowlist(classId: string) {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeClassAllowlist(classId),
    queryFn: () => fetchChatBridgeAllowlist(classId),
    staleTime: 30_000,
    enabled: !!classId && !loading && isAuthenticated,
  })
}

export async function fetchChatBridgeReviewActions(): Promise<ChatBridgeReviewAction[]> {
  const response = await fetchJson<ReviewActionsApiResponse>('/api/review-actions')
  return response.actions
}

export function useChatBridgeReviewActions() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeReviewActions,
    queryFn: fetchChatBridgeReviewActions,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export async function registerChatBridgeApp(manifest: BridgeAppManifest) {
  const response = await sendJson<RegistryAppResponse>('/api/registry/apps', 'POST', manifest)
  await invalidateChatBridgeQueries()
  return augmentAppDefinition({
    ...response.app.manifest,
    reviewState: response.app.reviewState,
    ownerUserId: response.app.ownerUserId,
    ownerEmail: response.app.ownerEmail,
    reviewNotes: response.app.reviewNotes,
    reviewedAt: response.app.reviewedAt,
    registeredAt: response.app.registeredAt,
    activeVersion: response.app.activeVersion,
    pendingVersion: response.app.pendingVersion,
  })
}

export async function reviewChatBridgeApp(
  appId: string,
  input: {
    reviewState: ChatBridgeAppDefinition['reviewState']
    reviewerId: string
    reviewNotes?: string
    version?: string
  }
) {
  const response = await sendJson<RegistryAppResponse>(`/api/registry/apps/${appId}/review`, 'POST', input)
  await invalidateChatBridgeQueries()
  return augmentAppDefinition({
    ...response.app.manifest,
    reviewState: response.app.reviewState,
    ownerUserId: response.app.ownerUserId,
    ownerEmail: response.app.ownerEmail,
    reviewNotes: response.app.reviewNotes,
    reviewedAt: response.app.reviewedAt,
    registeredAt: response.app.registeredAt,
    activeVersion: response.app.activeVersion,
    pendingVersion: response.app.pendingVersion,
  })
}

export async function enableChatBridgeAppForClass(classId: string, appId: string, enabledBy: string) {
  await sendJson<ClassAllowlistApiResponse>(`/api/classes/${classId}/allowlist`, 'POST', {
    appId,
    enabledBy,
  })
  await invalidateChatBridgeQueries(classId)
}

export async function disableChatBridgeAppForClass(classId: string, appId: string, enabledBy: string) {
  await sendJson<ClassAllowlistApiResponse>(`/api/classes/${classId}/allowlist/${appId}/disable`, 'POST', {
    enabledBy,
  })
  await invalidateChatBridgeQueries(classId)
}

function makePostMessageScript(appId: string, eventType: string, payload: Record<string, unknown>) {
  return `window.parent.postMessage(${JSON.stringify({
    source: 'chatbridge-app',
    version: '1.0',
    appId,
    type: eventType,
    payload,
  })}, '*')`
}

function buildMockFrame(config: {
  appId: string
  title: string
  accent: string
  subtitle: string
  stateLabel: string
  statePayload: Record<string, unknown>
  completionLabel: string
  completionPayload: Record<string, unknown>
}) {
  const readyScript = makePostMessageScript(config.appId, 'APP_READY', {
    summary: `${config.title} is ready.`,
  })
  const stateScript = makePostMessageScript(config.appId, 'STATE_UPDATE', config.statePayload)
  const completeScript = makePostMessageScript(config.appId, 'APP_COMPLETE', config.completionPayload)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: linear-gradient(135deg, ${config.accent} 0%, #ffffff 80%);
        color: #111827;
      }
      .shell {
        padding: 20px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      p {
        margin: 0 0 16px;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 600;
      }
      .primary {
        background: #111827;
        color: white;
      }
      .secondary {
        background: white;
        color: #111827;
        box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.12);
      }
      .panel {
        margin-top: 16px;
        padding: 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.76);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <h1>${config.title}</h1>
      <p>${config.subtitle}</p>
      <div class="actions">
        <button id="ready-btn" class="primary">Send Ready Event</button>
        <button id="state-btn" class="secondary">${config.stateLabel}</button>
        <button id="complete-btn" class="secondary">${config.completionLabel}</button>
      </div>
      <div class="panel">
        <strong>Bridge status:</strong> <span id="bridge-status">Waiting for INIT from TutorMeAI.</span>
      </div>
    </div>
    <script>
      var readySent = false

      function sendReady() {
        if (readySent) {
          return
        }

        readySent = true
        ${readyScript}
      }

      function sendHeartbeat() {
        window.parent.postMessage({
          source: 'chatbridge-app',
          version: '1.0',
          appId: ${JSON.stringify(config.appId)},
          type: 'HEARTBEAT'
        }, '*')
      }

      window.addEventListener('message', function (event) {
        var data = event.data || {}
        if (data.source !== 'chatbridge-host' || data.appId !== ${JSON.stringify(config.appId)}) {
          return
        }

        var status = document.getElementById('bridge-status')
        if (data.type === 'INIT') {
          var classId = data.payload && data.payload.classId ? data.payload.classId : 'unknown-class'
          status.textContent = 'INIT received for ' + classId + '. Ready to send events.'
          sendReady()
          return
        }

        if (data.type === 'PING') {
          status.textContent = 'PING received. Sending heartbeat back to TutorMeAI.'
          sendHeartbeat()
          return
        }

        if (data.type === 'AUTH_RESULT') {
          status.textContent = data.payload && data.payload.success
            ? 'Authorization updated. Ready to continue.'
            : 'Authorization cleared.'
          return
        }

        if (data.type === 'TERMINATE') {
          status.textContent = 'TutorMeAI ended the app session.'
        }
      })

      document.getElementById('ready-btn').addEventListener('click', function () {
        sendReady()
      })
      document.getElementById('state-btn').addEventListener('click', function () {
        ${stateScript}
      })
      document.getElementById('complete-btn').addEventListener('click', function () {
        ${completeScript}
      })
    </script>
  </body>
</html>`
}

export function getChatBridgeMockSrcDoc(app: ChatBridgeAppDefinition): string | undefined {
  if (app.launchUrl && !app.allowedOrigins.includes('null')) {
    return undefined
  }

  switch (app.mockMode) {
    case 'chess':
      return buildMockFrame({
        appId: app.appId,
        title: 'Chess Coach',
        accent: '#dbeafe',
        subtitle: 'Simulates a long-lived board game with tutoring checkpoints.',
        stateLabel: 'Update Board State',
        statePayload: {
          summary: 'White to move on turn 12 after a kingside attack setup.',
          state: {
            fen: 'r1bq1rk1/pp1nbppp/2n1p3/2ppP3/3P4/2PB1N2/PP3PPP/RNBQ1RK1 w - - 0 12',
            phase: 'middlegame',
          },
        },
        completionLabel: 'Complete Game',
        completionPayload: {
          summary: 'Game finished. White won by checkmate after a coordinated attack on the king.',
          state: {
            outcome: 'white_win',
            ending: 'checkmate',
          },
        },
      })
    case 'weather':
      return buildMockFrame({
        appId: app.appId,
        title: 'Weather Dashboard',
        accent: '#dcfce7',
        subtitle: 'Simulates a lightweight public app with short-lived state.',
        stateLabel: 'Update Forecast',
        statePayload: {
          summary: 'Forecast loaded for Chicago: 62F, windy, chance of rain after school.',
          state: {
            location: 'Chicago',
            temperatureF: 62,
            condition: 'windy',
          },
        },
        completionLabel: 'Finish Lookup',
        completionPayload: {
          summary: 'Weather lookup complete. The student can now ask follow-up questions about the forecast.',
          state: {
            location: 'Chicago',
          },
        },
      })
    case 'classroom':
      return buildMockFrame({
        appId: app.appId,
        title: 'Google Classroom Assistant',
        accent: '#fef3c7',
        subtitle: 'Simulates a read-only authenticated app with workload context.',
        stateLabel: 'Load Coursework',
        statePayload: {
          summary: 'Three assignments are due this week, including algebra practice on Thursday.',
          state: {
            courseCount: 3,
            nextDue: 'Thursday',
            workload: 'moderate',
          },
        },
        completionLabel: 'Finish Session',
        completionPayload: {
          summary: 'Google Classroom sync finished. TutorMeAI can now coach the student on upcoming work.',
          state: {
            syncStatus: 'complete',
          },
        },
      })
    default:
      return undefined
  }
}
