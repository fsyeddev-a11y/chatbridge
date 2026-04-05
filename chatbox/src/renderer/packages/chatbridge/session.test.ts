import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, updateSessionCacheMock, getSupabaseAuthHeadersMock, fetchMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateSessionCacheMock: vi.fn(),
  getSupabaseAuthHeadersMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/stores/chatStore', () => ({
  getSession: getSessionMock,
  updateSessionCache: updateSessionCacheMock,
}))

vi.mock('@/packages/supabase', () => ({
  getSupabaseAuthHeaders: getSupabaseAuthHeadersMock,
}))

import { activateBridgeApp, closeBridgeApp, hydrateBridgeStateFromBackend, updateBridgeAppContext } from './session'

describe('ChatBridge session helpers', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    updateSessionCacheMock.mockReset()
    getSupabaseAuthHeadersMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    getSupabaseAuthHeadersMock.mockResolvedValue({
      Authorization: 'Bearer token-1',
    })
  })

  it('reopens an errored app by restoring active status and clearing the last error', async () => {
    let nextSession: Session | undefined
    updateSessionCacheMock.mockImplementation(async (_sessionId, updater) => {
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

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'session-1',
        bridgeState: nextSession?.bridgeState,
      }),
    })

    await activateBridgeApp('session-1', 'chess')

    expect(updateSessionCacheMock).toHaveBeenCalled()
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
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/sessions/session-1/bridge-state',
      expect.objectContaining({
        method: 'PUT',
      })
    )
  })

  it('hydrates local bridge state from the backend session record', async () => {
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'Bridge Session',
      messages: [],
      bridgeState: {
        activeClassId: 'demo-class',
        appContext: {},
      },
    } satisfies Session)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'session-1',
        bridgeState: {
          activeClassId: 'demo-class',
          activeAppId: 'weather',
          appContext: {
            weather: {
              appId: 'weather',
              status: 'ready',
              summary: 'Chicago is 72F and sunny.',
            },
          },
        },
      }),
    })

    await hydrateBridgeStateFromBackend('session-1')

    expect(updateSessionCacheMock).toHaveBeenCalled()
    const updater = updateSessionCacheMock.mock.calls[0][1]
    const updated = updater({
      id: 'session-1',
      name: 'Bridge Session',
      messages: [],
      bridgeState: {
        activeClassId: 'demo-class',
        appContext: {},
      },
    } satisfies Session)

    expect(updated.bridgeState?.activeAppId).toBe('weather')
    expect(updated.bridgeState?.appContext.weather.summary).toBe('Chicago is 72F and sunny.')
  })

  it('adopts backend-returned canonical bridge state after activation', async () => {
    updateSessionCacheMock.mockImplementation(async (_sessionId, updater) =>
      updater({
        id: 'session-1',
        name: 'Bridge Session',
        messages: [],
        bridgeState: {
          activeClassId: 'demo-class',
          appContext: {},
        },
      } satisfies Session)
    )

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'session-1',
        bridgeState: {
          activeClassId: 'server-class',
          activeAppId: 'weather',
          appContext: {
            weather: {
              appId: 'weather',
              status: 'ready',
              summary: 'Server canonical weather state.',
            },
          },
        },
      }),
    })

    const result = await activateBridgeApp('session-1', 'weather')

    expect(result.bridgeState?.activeClassId).toBe('server-class')
    expect(result.bridgeState?.appContext.weather.summary).toBe('Server canonical weather state.')
    expect(updateSessionCacheMock).toHaveBeenCalledTimes(2)
  })

  it('adopts backend-returned canonical bridge state after context updates and close', async () => {
    updateSessionCacheMock.mockImplementation(async (_sessionId, updater) =>
      updater({
        id: 'session-1',
        name: 'Bridge Session',
        messages: [],
        bridgeState: {
          activeClassId: 'demo-class',
          activeAppId: 'weather',
          appContext: {
            weather: {
              appId: 'weather',
              status: 'active',
              summary: 'Local summary',
            },
          },
        },
      } satisfies Session)
    )

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-1',
          bridgeState: {
            activeClassId: 'demo-class',
            activeAppId: 'weather',
            appContext: {
              weather: {
                appId: 'weather',
                status: 'complete',
                summary: 'Canonical backend summary',
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-1',
          bridgeState: {
            activeClassId: 'demo-class',
            appContext: {
              weather: {
                appId: 'weather',
                status: 'complete',
                summary: 'Canonical backend summary',
              },
            },
          },
        }),
      })

    const updated = await updateBridgeAppContext('session-1', 'weather', {
      status: 'error',
      summary: 'Frontend optimistic state',
    })
    const closed = await closeBridgeApp('session-1')

    expect(updated.bridgeState?.appContext.weather.status).toBe('complete')
    expect(updated.bridgeState?.appContext.weather.summary).toBe('Canonical backend summary')
    expect(closed.bridgeState?.activeAppId).toBeUndefined()
    expect(closed.bridgeState?.appContext.weather.summary).toBe('Canonical backend summary')
  })
})
