import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Message, StreamTextResult } from '@shared/types'
import type { ModelInterface } from '@shared/models/types'

const { getChatBridgeToolSetMock, emitChatBridgeEventMock } = vi.hoisted(() => ({
  getChatBridgeToolSetMock: vi.fn(),
  emitChatBridgeEventMock: vi.fn(),
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn().mockResolvedValue({
    storage: {
      getImage: vi.fn(),
    },
  }),
}))

vi.mock('./toolsets/chatbridge', () => ({
  getChatBridgeToolSet: getChatBridgeToolSetMock,
}))

vi.mock('@/packages/chatbridge/observability', () => ({
  emitChatBridgeEvent: emitChatBridgeEventMock,
}))

import { streamText } from './stream-text'

function createMessage(role: 'user' | 'system', text: string): Message {
  return {
    id: `${role}-1`,
    role,
    contentParts: [{ type: 'text', text }],
    tokenCalculatedAt: undefined,
  }
}

describe('streamText ChatBridge integration', () => {
  beforeEach(() => {
    getChatBridgeToolSetMock.mockReset()
    emitChatBridgeEventMock.mockReset()
  })

  it('injects Bridge context and emits generation lifecycle events', async () => {
    getChatBridgeToolSetMock.mockResolvedValue({
      description: 'Current ChatBridge state:\n- Active class: demo-class\n- Active app summary: Chess state: phase: "middlegame"',
      tools: {
        chatbridge_chess_start_game: {
          description: 'Start chess',
          inputSchema: {},
          execute: vi.fn(),
        },
      },
      availableToolNames: ['chatbridge_chess_start_game'],
      activeAppId: 'chess',
      activeClassId: 'demo-class',
      activeAppSummary: 'Chess state: phase: "middlegame"',
    })

    let capturedMessages: any[] = []
    let capturedTools: Record<string, unknown> | undefined
    const model: ModelInterface = {
      name: 'Test Model',
      modelId: 'test-model',
      isSupportVision: () => true,
      isSupportToolUse: () => true,
      isSupportSystemMessage: () => true,
      paint: vi.fn(),
      chat: vi.fn(async (messages, options) => {
        capturedMessages = messages
        capturedTools = options.tools
        const result: StreamTextResult = {
          contentParts: [
            {
              type: 'tool-call',
              state: 'result',
              toolCallId: 'tool-1',
              toolName: 'chatbridge_chess_start_game',
              args: {},
              result: { status: 'opened' },
            },
          ],
          finishReason: 'stop',
        }
        return result
      }),
    }

    await streamText(model, {
      sessionId: 'session-1',
      messages: [createMessage('system', 'You are helpful.'), createMessage('user', "let's play chess")],
      onResultChangeWithCancel: vi.fn(),
    })

    expect(capturedMessages[0].role).toBe('system')
    expect(capturedMessages[0].content).toContain('Current ChatBridge state:')
    expect(capturedMessages[0].content).toContain('Active app summary: Chess state: phase: "middlegame"')
    expect(capturedTools).toHaveProperty('chatbridge_chess_start_game')
    expect(emitChatBridgeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GenerationStarted',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          classId: 'demo-class',
          model: 'test-model',
        }),
      })
    )
    expect(emitChatBridgeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ToolsetAssembled',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          activeAppId: 'chess',
          availableToolNames: expect.arrayContaining(['chatbridge_chess_start_game']),
        }),
      })
    )
    expect(emitChatBridgeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GenerationCompleted',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          finishReason: 'stop',
          invokedToolNames: ['chatbridge_chess_start_game'],
        }),
      })
    )
  })
})
