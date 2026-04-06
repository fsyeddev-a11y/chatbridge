import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import ChatBridgeWorkspace from '@/components/settings/ChatBridgeWorkspace'
import { getChatBridgeSettingsAccess, useChatBridgeMe } from '@/packages/chatbridge/registry'

export const Route = createFileRoute('/settings/chatbridge')({
  component: RouteComponent,
})

export function RouteComponent() {
  const navigate = useNavigate()
  const { data: workspaceUser, isLoading } = useChatBridgeMe()
  const { canAccessSettings } = getChatBridgeSettingsAccess(workspaceUser)

  useEffect(() => {
    if (!isLoading && !canAccessSettings) {
      navigate({ to: '/settings', replace: true })
    }
  }, [canAccessSettings, isLoading, navigate])

  if (isLoading || !canAccessSettings) {
    return null
  }

  return <ChatBridgeWorkspace />
}
