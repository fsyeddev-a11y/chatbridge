import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateSessionWithMessagesMock } = vi.hoisted(() => ({
  updateSessionWithMessagesMock: vi.fn(),
}))

vi.mock('@/stores/chatStore', () => ({
  updateSessionWithMessages: updateSessionWithMessagesMock,
}))

import { activateBridgeApp } from './session'

describe('ChatBridge session helpers', () => {
  beforeEach(() => {
    updateSessionWithMessagesMock.mockReset()
  })

  it('reopens an errored app by restoring active status and clearing the last error', async () => {
    let nextSession: Session | undefined
    updateSessionWithMessagesMock.mockImplementation(async (_sessionId, updater) => {
      const session: Session = {
        id: 'session-1',
        name: 'Bridge Session',
        messages: [],
        bridgeState: {
          activeClassId: 'demo-class',
          activeAppId: 'chess',
          appContext: {
            chess: {
              appId: 'chess',
              status: 'error',
              summary: 'Last known board state.',
              lastState: {
                phase: 'middlegame',
              },
              lastError: 'The app stopped responding.',
            },
          },
        },
      }

      nextSession = updater(session)
      return nextSession
    })

    await activateBridgeApp('session-1', 'chess')

    expect(updateSessionWithMessagesMock).toHaveBeenCalled()
    expect(nextSession?.bridgeState?.activeAppId).toBe('chess')
    expect(nextSession?.bridgeState?.appContext.chess).toEqual(
      expect.objectContaining({
        appId: 'chess',
        status: 'active',
        summary: 'Last known board state.',
        lastState: {
          phase: 'middlegame',
        },
        lastError: undefined,
      })
    )
  })
})
