// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatBridgeControlPanel from './ChatBridgeControlPanel'

const {
  useChatBridgeAppsMock,
  useChatBridgeAllowlistMock,
  enableChatBridgeAppForClassMock,
  disableChatBridgeAppForClassMock,
  registerChatBridgeAppMock,
  reviewChatBridgeAppMock,
  getSessionBridgeStateMock,
} = vi.hoisted(() => ({
  useChatBridgeAppsMock: vi.fn(),
  useChatBridgeAllowlistMock: vi.fn(),
  enableChatBridgeAppForClassMock: vi.fn(),
  disableChatBridgeAppForClassMock: vi.fn(),
  registerChatBridgeAppMock: vi.fn(),
  reviewChatBridgeAppMock: vi.fn(),
  getSessionBridgeStateMock: vi.fn(),
}))

vi.mock('@/packages/chatbridge/registry', () => ({
  useChatBridgeApps: useChatBridgeAppsMock,
  useChatBridgeAllowlist: useChatBridgeAllowlistMock,
  enableChatBridgeAppForClass: enableChatBridgeAppForClassMock,
  disableChatBridgeAppForClass: disableChatBridgeAppForClassMock,
  registerChatBridgeApp: registerChatBridgeAppMock,
  reviewChatBridgeApp: reviewChatBridgeAppMock,
}))

vi.mock('@/packages/chatbridge/session', () => ({
  getSessionBridgeState: getSessionBridgeStateMock,
}))

const session: Session = {
  id: 'session-1',
  name: 'Bridge Session',
  messages: [],
  bridgeState: {
    activeClassId: 'demo-class',
    appContext: {},
  },
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <ChatBridgeControlPanel session={session} />
      </QueryClientProvider>
    </MantineProvider>
  )
}

describe('ChatBridgeControlPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    getSessionBridgeStateMock.mockReturnValue({
      activeClassId: 'demo-class',
      appContext: {},
    })
    useChatBridgeAppsMock.mockReturnValue({
      data: [
        {
          appId: 'chess',
          name: 'Chess Coach',
          version: '1.0.0',
          description: 'Chess tutoring.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://apps.chatbridge.local'],
          authType: 'none',
          subjectTags: ['Strategy'],
          gradeBand: '3-12',
          llmSafeFields: ['phase'],
          tools: [],
          reviewState: 'approved',
          enabledClassIds: [],
          llmOwnership: 'platform',
        },
        {
          appId: 'story-builder',
          name: 'AI Story Builder',
          version: '1.0.0',
          description: 'Story drafting.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://apps.chatbridge.local'],
          authType: 'none',
          subjectTags: ['ELA'],
          gradeBand: '3-8',
          llmSafeFields: ['storyTitle'],
          tools: [],
          reviewState: 'pending',
          enabledClassIds: [],
          llmOwnership: 'platform',
        },
      ],
    })
    useChatBridgeAllowlistMock.mockReturnValue({
      data: [],
    })
    enableChatBridgeAppForClassMock.mockResolvedValue(undefined)
    disableChatBridgeAppForClassMock.mockResolvedValue(undefined)
    registerChatBridgeAppMock.mockResolvedValue(undefined)
    reviewChatBridgeAppMock.mockResolvedValue(undefined)
  })

  it('renders review and teacher controls from backend-backed app data', () => {
    renderPanel()

    expect(screen.getByText('ChatBridge Control Plane')).toBeTruthy()
    expect(screen.getByText('Developer/Admin')).toBeTruthy()
    expect(screen.getByText('Teacher Allowlist')).toBeTruthy()
    expect(screen.getAllByText('Chess Coach')).toHaveLength(2)
    expect(screen.getByText('AI Story Builder')).toBeTruthy()
  })

  it('calls the teacher allowlist mutation with the active class context', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => {
      expect(enableChatBridgeAppForClassMock).toHaveBeenCalledWith('demo-class', 'chess', 'teacher-demo')
    })
  })
})
