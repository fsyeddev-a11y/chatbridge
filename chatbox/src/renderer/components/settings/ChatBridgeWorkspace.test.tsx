// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatBridgeWorkspace from './ChatBridgeWorkspace'

const {
  useChatBridgeMeMock,
  useChatBridgeAppsMock,
  useChatBridgeSchoolAllowlistMock,
  useChatBridgeAllowlistMock,
  useChatBridgeReviewActionsMock,
  useDeveloperChatBridgeAppsMock,
  useDeveloperChatBridgeReviewActionsMock,
  enableChatBridgeAppForClassMock,
  disableChatBridgeAppForClassMock,
  enableChatBridgeAppForSchoolMock,
  disableChatBridgeAppForSchoolMock,
  registerChatBridgeAppMock,
  reviewChatBridgeAppMock,
  fetchDeveloperChatBridgeAppsMock,
} = vi.hoisted(() => ({
  useChatBridgeMeMock: vi.fn(),
  useChatBridgeAppsMock: vi.fn(),
  useChatBridgeSchoolAllowlistMock: vi.fn(),
  useChatBridgeAllowlistMock: vi.fn(),
  useChatBridgeReviewActionsMock: vi.fn(),
  useDeveloperChatBridgeAppsMock: vi.fn(),
  useDeveloperChatBridgeReviewActionsMock: vi.fn(),
  enableChatBridgeAppForClassMock: vi.fn(),
  disableChatBridgeAppForClassMock: vi.fn(),
  enableChatBridgeAppForSchoolMock: vi.fn(),
  disableChatBridgeAppForSchoolMock: vi.fn(),
  registerChatBridgeAppMock: vi.fn(),
  reviewChatBridgeAppMock: vi.fn(),
  fetchDeveloperChatBridgeAppsMock: vi.fn(),
}))

vi.mock('@/packages/chatbridge/registry', () => ({
  useChatBridgeMe: useChatBridgeMeMock,
  useChatBridgeApps: useChatBridgeAppsMock,
  useChatBridgeSchoolAllowlist: useChatBridgeSchoolAllowlistMock,
  useChatBridgeAllowlist: useChatBridgeAllowlistMock,
  useChatBridgeReviewActions: useChatBridgeReviewActionsMock,
  useDeveloperChatBridgeApps: useDeveloperChatBridgeAppsMock,
  useDeveloperChatBridgeReviewActions: useDeveloperChatBridgeReviewActionsMock,
  enableChatBridgeAppForClass: enableChatBridgeAppForClassMock,
  disableChatBridgeAppForClass: disableChatBridgeAppForClassMock,
  enableChatBridgeAppForSchool: enableChatBridgeAppForSchoolMock,
  disableChatBridgeAppForSchool: disableChatBridgeAppForSchoolMock,
  registerChatBridgeApp: registerChatBridgeAppMock,
  reviewChatBridgeApp: reviewChatBridgeAppMock,
  fetchDeveloperChatBridgeApps: fetchDeveloperChatBridgeAppsMock,
  getChatBridgeSettingsAccess: (workspaceUser: any) => {
    const roles = workspaceUser?.user.roles || []
    const schoolMemberships = workspaceUser?.schoolMemberships || []
    const classMemberships = workspaceUser?.classMemberships || workspaceUser?.memberships || []
    const managedSchoolIds = schoolMemberships
      .filter((membership: any) => membership.membershipRole === 'school_admin')
      .map((membership: any) => membership.schoolId)
    const taughtClassIds = classMemberships
      .filter((membership: any) => membership.membershipRole === 'teacher')
      .map((membership: any) => membership.classId)

    return {
      canAccessSettings:
        roles.includes('admin') || roles.includes('developer') || managedSchoolIds.length > 0 || taughtClassIds.length > 0,
      hasAdminAccess: roles.includes('admin'),
      hasDeveloperAccess: roles.includes('developer'),
      managedSchoolIds,
      taughtClassIds,
    }
  },
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

const appsFixture = [
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
]

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

    useChatBridgeMeMock.mockReturnValue({
      data: {
        user: {
          userId: 'teacher-1',
          email: 'teacher@example.com',
          role: 'student',
          roles: ['student'],
          createdAt: 1,
          updatedAt: 1,
        },
        schools: [
          {
            schoolId: 'demo-school',
            name: 'Demo School',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        schoolMemberships: [
          {
            schoolId: 'demo-school',
            userId: 'teacher-1',
            membershipRole: 'teacher',
            createdAt: 1,
          },
        ],
        classes: [
          {
            classId: 'demo-class',
            schoolId: 'demo-school',
            name: 'Demo Class',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        memberships: [
          {
            classId: 'demo-class',
            userId: 'teacher-1',
            membershipRole: 'teacher',
            createdAt: 1,
          },
        ],
        classMemberships: [
          {
            classId: 'demo-class',
            userId: 'teacher-1',
            membershipRole: 'teacher',
            createdAt: 1,
          },
        ],
      },
      isLoading: false,
      error: undefined,
    })
    useChatBridgeAppsMock.mockReturnValue({
      data: appsFixture,
      error: undefined,
    })
    useChatBridgeSchoolAllowlistMock.mockReturnValue({
      data: [{ schoolId: 'demo-school', appId: 'weather', enabledBy: 'school-admin-1', enabledAt: 1712000000000 }],
      error: undefined,
    })
    useChatBridgeAllowlistMock.mockReturnValue({
      data: [{ classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: 1712000000000 }],
      error: undefined,
    })
    useChatBridgeReviewActionsMock.mockReturnValue({
      data: [],
      error: undefined,
    })
    useDeveloperChatBridgeAppsMock.mockReturnValue({
      data: [],
      error: undefined,
    })
    useDeveloperChatBridgeReviewActionsMock.mockReturnValue({
      data: [],
      error: undefined,
    })
    enableChatBridgeAppForClassMock.mockResolvedValue(undefined)
    disableChatBridgeAppForClassMock.mockResolvedValue(undefined)
    enableChatBridgeAppForSchoolMock.mockResolvedValue(undefined)
    disableChatBridgeAppForSchoolMock.mockResolvedValue(undefined)
    registerChatBridgeAppMock.mockResolvedValue(undefined)
    reviewChatBridgeAppMock.mockResolvedValue(undefined)
    fetchDeveloperChatBridgeAppsMock.mockResolvedValue([])
  })

  it('shows only the teacher class allowlist workspace for teachers and includes school-approved state', () => {
    renderWorkspace()

    expect(screen.getByText('Teacher Class Allowlist')).toBeTruthy()
    expect(screen.queryByText('School App Approval')).toBeNull()
    expect(screen.queryByText('Admin Registry Review')).toBeNull()
    expect(screen.queryByText('Developer Portal')).toBeNull()
    expect(screen.getByText('School Enabled')).toBeTruthy()
  })

  it('lets a teacher manage class allowlist using school-approved state', async () => {
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Disable for Class' }))

    await waitFor(() => {
      expect(disableChatBridgeAppForClassMock).toHaveBeenCalledWith('demo-class', 'weather', 'teacher-demo')
    })
  })

  it('does not render ChatBridge controls for students', () => {
    useChatBridgeMeMock.mockReturnValue({
      data: {
        user: {
          userId: 'student-1',
          email: 'student@example.com',
          role: 'student',
          roles: ['student'],
          createdAt: 1,
          updatedAt: 1,
        },
        schools: [],
        schoolMemberships: [],
        classes: [],
        memberships: [],
        classMemberships: [],
      },
      isLoading: false,
      error: undefined,
    })

    renderWorkspace()

    expect(screen.getByText(/does not currently have ChatBridge workspace permissions/i)).toBeTruthy()
    expect(screen.queryByText('Teacher Class Allowlist')).toBeNull()
    expect(screen.queryByText('School App Approval')).toBeNull()
    expect(screen.queryByText('Admin Registry Review')).toBeNull()
    expect(screen.queryByText('Developer Portal')).toBeNull()
  })

  it('shows admin, school approval, and teacher allowlist sections for a pure platform admin', () => {
    useChatBridgeMeMock.mockReturnValue({
      data: {
        user: {
          userId: 'platform-admin-1',
          email: 'admin@example.com',
          role: 'admin',
          roles: ['admin'],
          createdAt: 1,
          updatedAt: 1,
        },
        schools: [
          {
            schoolId: 'demo-school',
            name: 'Demo School',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        schoolMemberships: [],
        classes: [
          {
            classId: 'demo-class',
            schoolId: 'demo-school',
            name: 'Demo Class',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        memberships: [],
        classMemberships: [],
      },
      isLoading: false,
      error: undefined,
    })

    renderWorkspace()

    expect(screen.getByText('Admin Registry Review')).toBeTruthy()
    expect(screen.getByText('School App Approval')).toBeTruthy()
    expect(screen.getByText('Teacher Class Allowlist')).toBeTruthy()
  })
})
