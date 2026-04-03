import { describe, expect, it, vi } from 'vitest'
import {
  buildHostBridgeEnvelope,
  getBridgeFailureMessage,
  getHeartbeatIntervalMs,
  getHeartbeatTimeoutMs,
  getIframeSandboxPolicy,
  isAllowedOrigin,
  isBridgeEnvelope,
  postHostBridgeMessage,
  resolveBridgeEnvelope,
  resolveHostPostMessageTargetOrigin,
  shouldSendHeartbeatPing,
} from '@/packages/chatbridge/panel-runtime'
import type { ChatBridgeAppDefinition } from '@/packages/chatbridge/registry'

const chessApp: ChatBridgeAppDefinition = {
  appId: 'chess',
  name: 'Chess Coach',
  version: '1.0.0',
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

  it('accepts heartbeat events without mutating stored app state', () => {
    const resolution = resolveBridgeEnvelope(
      chessApp,
      {
        source: 'chatbridge-app',
        version: '1.0',
        appId: 'chess',
        type: 'HEARTBEAT',
      },
      'https://apps.example.com'
    )

    expect(resolution.accepted).toBe(true)
    if (resolution.accepted) {
      expect(resolution.eventName).toBe('AppHeartbeatReceived')
      expect(resolution.nextState).toEqual({})
    }
  })

  it('builds host envelopes and targets srcDoc apps safely', () => {
    const srcDocApp = {
      ...chessApp,
      allowedOrigins: ['null'],
      mockMode: 'chess' as const,
    }

    const envelope = buildHostBridgeEnvelope(srcDocApp, 'INIT', {
      sessionId: 'session-1',
      classId: 'demo-class',
      locale: 'en-US',
      theme: 'light',
      previousState: { phase: 'opening' },
    })

    expect(envelope).toEqual({
      source: 'chatbridge-host',
      version: '1.0',
      appId: 'chess',
      type: 'INIT',
      payload: {
        sessionId: 'session-1',
        classId: 'demo-class',
        locale: 'en-US',
        theme: 'light',
        previousState: { phase: 'opening' },
      },
    })
    expect(resolveHostPostMessageTargetOrigin(srcDocApp)).toBe('*')
    expect(getIframeSandboxPolicy(srcDocApp, '<html></html>')).toBe('allow-scripts allow-forms allow-popups')
  })

  it('posts host messages into the iframe contentWindow', () => {
    const postMessage = vi.fn()
    const iframe = {
      contentWindow: {
        postMessage,
      },
    } as unknown as HTMLIFrameElement

    const result = postHostBridgeMessage(iframe, chessApp, 'PING')

    expect(result.sent).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: 'chatbridge-host',
        version: '1.0',
        appId: 'chess',
        type: 'PING',
        payload: undefined,
      },
      'https://apps.example.com'
    )
  })

  it('allows same-origin only for real hosted iframe apps', () => {
    expect(getIframeSandboxPolicy(chessApp)).toBe('allow-scripts allow-forms allow-popups allow-same-origin')
    expect(getIframeSandboxPolicy(chessApp, '<html></html>')).toBe('allow-scripts allow-forms allow-popups')
  })

  it('derives heartbeat timing and ping eligibility from the manifest/runtime status', () => {
    expect(getHeartbeatTimeoutMs(chessApp)).toBe(10_000)
    expect(getHeartbeatIntervalMs(chessApp)).toBe(5_000)
    expect(shouldSendHeartbeatPing('ready')).toBe(true)
    expect(shouldSendHeartbeatPing('active')).toBe(true)
    expect(shouldSendHeartbeatPing('error')).toBe(false)
    expect(getBridgeFailureMessage('startup_timeout')).toContain('finished loading')
    expect(getBridgeFailureMessage('heartbeat_timeout')).toContain('stopped responding')
  })
})
