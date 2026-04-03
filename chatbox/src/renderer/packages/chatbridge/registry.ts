import type { BridgeAppManifest } from '@shared/types'

export type ChatBridgeAppDefinition = BridgeAppManifest & {
  reviewState: 'approved' | 'pending' | 'rejected' | 'suspended'
  enabledClassIds: string[]
  llmOwnership: 'platform'
  mockMode?: 'chess' | 'weather' | 'classroom'
}

const appRegistry: ChatBridgeAppDefinition[] = [
  {
    appId: 'chess',
    name: 'Chess Coach',
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
    description: 'Lightweight public weather app for quick lookups and contextual summaries.',
    developerName: 'ChatBridge Demo',
    executionModel: 'iframe',
    allowedOrigins: ['null'],
    authType: 'none',
    subjectTags: ['Science'],
    gradeBand: 'K-12',
    llmSafeFields: ['location', 'conditions', 'temperatureF'],
    reviewState: 'approved',
    enabledClassIds: ['demo-class'],
    llmOwnership: 'platform',
    mockMode: 'weather',
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
    description: 'Read-only classroom context for due dates, coursework, and tutoring follow-ups.',
    developerName: 'ChatBridge Demo',
    executionModel: 'iframe',
    allowedOrigins: ['null'],
    authType: 'oauth2',
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

export function getChatBridgeApps(): ChatBridgeAppDefinition[] {
  return appRegistry
}

export function getApprovedChatBridgeAppsForClass(classId: string): ChatBridgeAppDefinition[] {
  return appRegistry.filter((app) => app.reviewState === 'approved' && app.enabledClassIds.includes(classId))
}

export function getChatBridgeAppById(appId: string | undefined): ChatBridgeAppDefinition | undefined {
  if (!appId) {
    return undefined
  }
  return appRegistry.find((app) => app.appId === appId)
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
        This mock iframe is standing in for an external third-party app. It can only communicate with TutorMeAI
        through Bridge-controlled postMessage events.
      </div>
    </div>
    <script>
      document.getElementById('ready-btn').addEventListener('click', function () {
        ${readyScript}
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
