// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatBridgeWorkspace from './ChatBridgeWorkspace'

const {
  useChatBridgeAppsMock,
  useChatBridgeAllowlistMock,
  useChatBridgeReviewActionsMock,
  enableChatBridgeAppForClassMock,
  disableChatBridgeAppForClassMock,
  registerChatBridgeAppMock,
  reviewChatBridgeAppMock,
} = vi.hoisted(() => ({
  useChatBridgeAppsMock: vi.fn(),
  useChatBridgeAllowlistMock: vi.fn(),
  useChatBridgeReviewActionsMock: vi.fn(),
  enableChatBridgeAppForClassMock: vi.fn(),
  disableChatBridgeAppForClassMock: vi.fn(),
  registerChatBridgeAppMock: vi.fn(),
  reviewChatBridgeAppMock: vi.fn(),
}))

vi.mock('@/packages/chatbridge/registry', () => ({
  useChatBridgeApps: useChatBridgeAppsMock,
  useChatBridgeAllowlist: useChatBridgeAllowlistMock,
  useChatBridgeReviewActions: useChatBridgeReviewActionsMock,
  enableChatBridgeAppForClass: enableChatBridgeAppForClassMock,
  disableChatBridgeAppForClass: disableChatBridgeAppForClassMock,
  registerChatBridgeApp: registerChatBridgeAppMock,
  reviewChatBridgeApp: reviewChatBridgeAppMock,
}))

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <ChatBridgeWorkspace />
      </QueryClientProvider>
    </MantineProvider>
  )
}

describe('ChatBridgeWorkspace', () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }

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
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: ResizeObserverMock,
    })
    useChatBridgeAppsMock.mockReturnValue({
      data: [
        {
          appId: 'weather',
          name: 'Weather Dashboard',
          version: '1.0.0',
          description: 'Weather tutoring.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://weather.example.com'],
          authType: 'none',
          subjectTags: ['Science'],
          gradeBand: 'K-12',
          llmSafeFields: ['location'],
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
      data: [{ classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: 1712000000000 }],
    })
    useChatBridgeReviewActionsMock.mockReturnValue({
      data: [
        {
          appId: 'weather',
          version: '1.0.0',
          action: 'approve',
          reviewerId: 'platform-admin',
          timestamp: 1712000000000,
          notes: 'Approved',
        },
      ],
    })
    enableChatBridgeAppForClassMock.mockResolvedValue(undefined)
    disableChatBridgeAppForClassMock.mockResolvedValue(undefined)
    registerChatBridgeAppMock.mockResolvedValue(undefined)
    reviewChatBridgeAppMock.mockResolvedValue(undefined)
  })

  it('renders dedicated admin and teacher sections with review history', () => {
    renderWorkspace()

    expect(screen.getByText('ChatBridge Workspace')).toBeTruthy()
    expect(screen.getByText('Admin Registry Review')).toBeTruthy()
    expect(screen.getByText('Teacher Class Allowlist')).toBeTruthy()
    expect(screen.getByText('Recent Review History')).toBeTruthy()
    expect(screen.getAllByText('Weather Dashboard')).toHaveLength(2)
    expect(screen.getAllByText('AI Story Builder')).toHaveLength(2)
  })

  it('filters registry cards by review state', () => {
    renderWorkspace()

    fireEvent.click(screen.getByRole('radio', { name: 'Pending' }))

    expect(screen.getAllByText('AI Story Builder')).toHaveLength(2)
    expect(screen.getAllByText('Weather Dashboard')).toHaveLength(1)
  })

  it('updates the current class allowlist', async () => {
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Disable for Class' }))

    await waitFor(() => {
      expect(disableChatBridgeAppForClassMock).toHaveBeenCalledWith('demo-class', 'weather', 'teacher-demo')
    })
  })
})
