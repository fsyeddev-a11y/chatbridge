import { beforeEach, describe, expect, it, vi } from 'vitest'

const { trackEventMock, fetchMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/utils/track', () => ({
  trackEvent: trackEventMock,
}))

vi.mock('@/packages/supabase', () => ({
  getSupabaseAuthHeaders: vi.fn().mockResolvedValue({
    Authorization: 'Bearer token-1',
  }),
}))

vi.stubGlobal('fetch', fetchMock)

import { emitChatBridgeEvent } from './observability'
import { getSupabaseAuthHeaders } from '@/packages/supabase'

describe('emitChatBridgeEvent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    trackEventMock.mockReset()
    vi.mocked(getSupabaseAuthHeaders).mockReset()
    vi.mocked(getSupabaseAuthHeaders).mockResolvedValue({
      Authorization: 'Bearer token-1',
    })
  })

  it('skips backend audit delivery when no auth token is available', async () => {
    vi.mocked(getSupabaseAuthHeaders).mockResolvedValueOnce({})

    emitChatBridgeEvent({
      name: 'GenerationStarted',
      payload: {
        traceId: 'trace-2',
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards only defined structured fields to tracking', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    emitChatBridgeEvent({
      name: 'GenerationStarted',
      payload: {
        traceId: 'trace-1',
        sessionId: 'session-1',
        classId: 'class-1',
        availableToolNames: ['chatbridge_chess_start_game'],
        activeAppId: undefined,
      },
    })

    expect(trackEventMock).toHaveBeenCalledWith('chatbridge_GenerationStarted', {
      traceId: 'trace-1',
      sessionId: 'session-1',
      classId: 'class-1',
      availableToolNames: ['chatbridge_chess_start_game'],
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/audit/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
      })
    )
  })
})
