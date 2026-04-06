// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useNavigateMock, useChatBridgeMeMock } = vi.hoisted(() => ({
  useNavigateMock: vi.fn(),
  useChatBridgeMeMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<object>('@tanstack/react-router')
  return {
    ...actual,
    createFileRoute: () => () => ({}),
    useNavigate: () => useNavigateMock,
  }
})

vi.mock('@/components/settings/ChatBridgeWorkspace', () => ({
  default: () => <div>Workspace</div>,
}))

vi.mock('@/packages/chatbridge/registry', () => ({
  useChatBridgeMe: useChatBridgeMeMock,
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

import { RouteComponent } from '@/routes/settings/chatbridge'

describe('settings chatbridge route', () => {
  beforeEach(() => {
    useNavigateMock.mockReset()
    useChatBridgeMeMock.mockReset()
  })

  it('redirects students away from Settings -> ChatBridge', async () => {
    useChatBridgeMeMock.mockReturnValue({
      data: {
        user: {
          userId: 'student-1',
          roles: ['student'],
        },
        schoolMemberships: [],
        memberships: [],
        classMemberships: [],
      },
      isLoading: false,
    })

    const { queryByText } = render(<RouteComponent />)

    await waitFor(() => {
      expect(useNavigateMock).toHaveBeenCalledWith({ to: '/settings', replace: true })
    })
    expect(queryByText('Workspace')).toBeNull()
  })

  it('renders the workspace for teachers', () => {
    useChatBridgeMeMock.mockReturnValue({
      data: {
        user: {
          userId: 'teacher-1',
          roles: ['student'],
        },
        schoolMemberships: [],
        memberships: [{ classId: 'demo-class', membershipRole: 'teacher' }],
        classMemberships: [{ classId: 'demo-class', membershipRole: 'teacher' }],
      },
      isLoading: false,
    })

    const { getByText } = render(<RouteComponent />)

    expect(getByText('Workspace')).toBeTruthy()
    expect(useNavigateMock).not.toHaveBeenCalled()
  })

  it('renders the workspace for a pure platform admin', () => {
    useChatBridgeMeMock.mockReturnValue({
      data: {
        user: {
          userId: 'platform-admin-1',
          roles: ['admin'],
        },
        schoolMemberships: [],
        memberships: [],
        classMemberships: [],
      },
      isLoading: false,
    })

    const { getByText } = render(<RouteComponent />)

    expect(getByText('Workspace')).toBeTruthy()
    expect(useNavigateMock).not.toHaveBeenCalled()
  })
})
