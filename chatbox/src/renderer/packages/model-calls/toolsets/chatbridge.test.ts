import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

const { getSessionMock, activateBridgeAppMock, updateBridgeAppContextMock, emitChatBridgeEventMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  activateBridgeAppMock: vi.fn(),
  updateBridgeAppContextMock: vi.fn(),
  emitChatBridgeEventMock: vi.fn(),
}))

vi.mock('@/stores/chatStore', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/packages/chatbridge/session', async () => {
  const actual = await vi.importActual<typeof import('@/packages/chatbridge/session')>('@/packages/chatbridge/session')
  return {
    ...actual,
    activateBridgeApp: activateBridgeAppMock,
    updateBridgeAppContext: updateBridgeAppContextMock,
  }
})

vi.mock('@/packages/chatbridge/observability', () => ({
  emitChatBridgeEvent: emitChatBridgeEventMock,
}))

import { getChatBridgeToolSet } from './chatbridge'

describe('getChatBridgeToolSet', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    activateBridgeAppMock.mockReset()
    updateBridgeAppContextMock.mockReset()
    emitChatBridgeEventMock.mockReset()
  })

  it('returns approved tools for the active class and includes active state in the description', async () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [],
      bridgeState: {
        activeClassId: 'demo-class',
        activeAppId: 'chess',
        appContext: {
          chess: {
            appId: 'chess',
            status: 'active',
            lastState: {
              phase: 'middlegame',
              fen: 'safe-fen',
              privateNote: 'do-not-expose',
            },
          },
        },
      },
    }
    getSessionMock.mockResolvedValue(session)

    const toolSet = await getChatBridgeToolSet(session.id)

    expect(toolSet).not.toBeNull()
    expect(toolSet?.description).toContain('phase: "middlegame"')
    expect(toolSet?.description).toContain('fen: "safe-fen"')
    expect(toolSet?.description).not.toContain('do-not-expose')
    expect(toolSet?.tools).toHaveProperty('chatbridge_chess_start_game')
    expect(toolSet?.tools).toHaveProperty('chatbridge_weather_lookup')
    expect(toolSet?.tools).toHaveProperty('chatbridge_google_classroom_overview')
  })

  it('returns null when the session has no approved apps for its class', async () => {
    const session: Session = {
      id: 'session-2',
      name: 'No Apps',
      messages: [],
      bridgeState: {
        activeClassId: 'unknown-class',
        appContext: {},
      },
    }
    getSessionMock.mockResolvedValue(session)

    const toolSet = await getChatBridgeToolSet(session.id)

    expect(toolSet).toBeNull()
  })

  it('activates the app and records Bridge context when a tool executes', async () => {
    const session: Session = {
      id: 'session-3',
      name: 'Google Classroom Session',
      messages: [],
      bridgeState: {
        activeClassId: 'demo-class',
        appContext: {},
      },
    }
    getSessionMock.mockResolvedValue(session)

    const toolSet = await getChatBridgeToolSet(session.id)
    expect(toolSet).not.toBeNull()

    const result = await toolSet!.tools.chatbridge_google_classroom_overview.execute!({}, {})

    expect(activateBridgeAppMock).toHaveBeenCalledWith(session.id, 'google-classroom')
    expect(updateBridgeAppContextMock).toHaveBeenCalledWith(
      session.id,
      'google-classroom',
      expect.objectContaining({
        status: 'idle',
        lastState: expect.objectContaining({
          invokedTool: 'chatbridge_google_classroom_overview',
          requiresAuthorization: true,
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        appId: 'google-classroom',
        requiresAuthorization: true,
        authType: 'oauth2',
      })
    )
    expect(emitChatBridgeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ChatBridgeToolInvoked',
        payload: expect.objectContaining({
          traceId: 'chatbridge-trace-unknown',
          sessionId: session.id,
          appId: 'google-classroom',
          toolName: 'chatbridge_google_classroom_overview',
        }),
      })
    )
  })
})
