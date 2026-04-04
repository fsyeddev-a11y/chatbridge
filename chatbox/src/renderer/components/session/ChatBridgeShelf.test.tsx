// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatBridgeShelf from './ChatBridgeShelf'

const { useApprovedChatBridgeAppsForClassMock, getSessionBridgeStateMock, activateBridgeAppMock } = vi.hoisted(() => ({
  useApprovedChatBridgeAppsForClassMock: vi.fn(),
  getSessionBridgeStateMock: vi.fn(),
  activateBridgeAppMock: vi.fn(),
}))

vi.mock('@/packages/chatbridge/registry', () => ({
  useApprovedChatBridgeAppsForClass: useApprovedChatBridgeAppsForClassMock,
}))

vi.mock('@/packages/chatbridge/session', () => ({
  getSessionBridgeState: getSessionBridgeStateMock,
  activateBridgeApp: activateBridgeAppMock,
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

function renderShelf() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <ChatBridgeShelf session={session} />
      </QueryClientProvider>
    </MantineProvider>
  )
}

describe('ChatBridgeShelf', () => {
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
      activeAppId: undefined,
      appContext: {},
    })
    useApprovedChatBridgeAppsForClassMock.mockReturnValue({
      data: [
        {
          appId: 'weather',
          name: 'Weather Dashboard',
          version: '1.0.0',
          description: 'Weather app.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://apps.chatbridge.local'],
          authType: 'none',
          subjectTags: ['Science'],
          gradeBand: 'K-12',
          llmSafeFields: ['location'],
          tools: [],
          reviewState: 'approved',
          enabledClassIds: ['demo-class'],
          llmOwnership: 'platform',
        },
      ],
    })
    activateBridgeAppMock.mockResolvedValue(undefined)
  })

  it('starts collapsed and expands on toggle', () => {
    renderShelf()

    expect(screen.queryByText('Weather Dashboard')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand ChatBridge app shelf' }))
    expect(screen.getByText('Weather Dashboard')).toBeTruthy()
  })
})
