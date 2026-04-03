import { describe, expect, it } from 'vitest'
import { resolveBridgeEnvelope, isAllowedOrigin, isBridgeEnvelope } from '@/packages/chatbridge/panel-runtime'
import type { ChatBridgeAppDefinition } from '@/packages/chatbridge/registry'

const chessApp: ChatBridgeAppDefinition = {
  appId: 'chess',
  name: 'Chess Coach',
  description: 'Interactive chess app',
  developerName: 'Test',
  executionModel: 'iframe',
  launchUrl: 'https://example.com/chess',
  allowedOrigins: ['https://apps.example.com'],
  authType: 'none',
  subjectTags: [],
  gradeBand: '3-12',
  llmSafeFields: ['phase'],
  tools: [],
  reviewState: 'approved',
  enabledClassIds: ['demo-class'],
  llmOwnership: 'platform',
}

describe('ChatBridgePanel helpers', () => {
  it('accepts valid origins and rejects invalid ones', () => {
    expect(isAllowedOrigin('https://apps.example.com', chessApp.allowedOrigins)).toBe(true)
    expect(isAllowedOrigin('https://evil.example.com', chessApp.allowedOrigins)).toBe(false)
  })

  it('recognizes Bridge envelopes', () => {
    expect(
      isBridgeEnvelope({
        source: 'chatbridge-app',
        version: '1.0',
        appId: 'chess',
        type: 'APP_READY',
      })
    ).toBe(true)
    expect(isBridgeEnvelope({ foo: 'bar' })).toBe(false)
  })

  it('accepts valid state updates', () => {
    const resolution = resolveBridgeEnvelope(
      chessApp,
      {
        source: 'chatbridge-app',
        version: '1.0',
        appId: 'chess',
        type: 'STATE_UPDATE',
        payload: {
          summary: 'White to move.',
          state: { phase: 'middlegame' },
        },
      },
      'https://apps.example.com'
    )

    expect(resolution.accepted).toBe(true)
    if (resolution.accepted) {
      expect(resolution.eventName).toBe('AppStateAccepted')
      expect(resolution.nextState).toEqual(
        expect.objectContaining({
          status: 'active',
          summary: 'White to move.',
          lastState: { phase: 'middlegame' },
        })
      )
    }
  })

  it('rejects malformed state payloads', () => {
    const resolution = resolveBridgeEnvelope(
      chessApp,
      {
        source: 'chatbridge-app',
        version: '1.0',
        appId: 'chess',
        type: 'STATE_UPDATE',
        payload: {
          summary: 'bad',
          state: 'not-an-object',
        },
      },
      'https://apps.example.com'
    )

    expect(resolution).toEqual(
      expect.objectContaining({
        accepted: false,
        reason: 'invalid_state_payload',
      })
    )
  })

  it('rejects messages from disallowed origins', () => {
    const resolution = resolveBridgeEnvelope(
      chessApp,
      {
        source: 'chatbridge-app',
        version: '1.0',
        appId: 'chess',
        type: 'APP_READY',
      },
      'https://evil.example.com'
    )

    expect(resolution).toEqual(
      expect.objectContaining({
        accepted: false,
        reason: 'disallowed_origin',
      })
    )
  })
})
