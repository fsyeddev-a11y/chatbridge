import { describe, expect, it, vi } from 'vitest'

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}))

vi.mock('@/utils/track', () => ({
  trackEvent: trackEventMock,
}))

import { emitChatBridgeEvent } from './observability'

describe('emitChatBridgeEvent', () => {
  it('forwards only defined structured fields to tracking', () => {
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
  })
})
