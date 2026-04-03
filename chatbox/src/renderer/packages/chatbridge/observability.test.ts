import { describe, expect, it, vi } from 'vitest'

const { trackEventMock, fetchMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/utils/track', () => ({
  trackEvent: trackEventMock,
}))

vi.stubGlobal('fetch', fetchMock)

import { emitChatBridgeEvent } from './observability'

describe('emitChatBridgeEvent', () => {
  it('forwards only defined structured fields to tracking', () => {
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
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/audit/events',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })
})
