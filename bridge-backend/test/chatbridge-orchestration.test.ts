import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildChatBridgeOrchestrationMessage } from '../src/chatbridge-orchestration.js'
import type { AppRegistryEntry } from '../src/types.js'

const chessApp: AppRegistryEntry = {
  manifest: {
    appId: 'chess',
    name: 'Chess Coach',
    version: '1.0.0',
    description: 'Interactive chess practice.',
    developerName: 'Backend',
    executionModel: 'iframe',
    allowedOrigins: ['https://apps.example.com'],
    authType: 'none',
    subjectTags: [],
    gradeBand: '3-12',
    llmSafeFields: ['phase', 'fen'],
    tools: [
      {
        name: 'chatbridge_chess_start_game',
        description: 'Start a new game.',
      },
    ],
  },
  reviewState: 'approved',
  registeredAt: Date.now(),
}

describe('chatbridge orchestration message', () => {
  it('includes recently closed app context when no app is currently active', () => {
    const message = buildChatBridgeOrchestrationMessage({
      classId: 'demo-class',
      approvedApps: [chessApp],
      bridgeState: {
        activeClassId: 'demo-class',
        appContext: {
          chess: {
            appId: 'chess',
            status: 'closed',
            summary: 'White had a strong kingside attack.',
            lastEventAt: 200,
          },
        },
      },
    })

    assert.equal(message.role, 'system')
    assert.equal(message.content.includes('was closed by the user'), true)
    assert.equal(message.content.includes('White had a strong kingside attack.'), true)
  })
})
