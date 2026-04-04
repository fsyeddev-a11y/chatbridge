import { createFileRoute } from '@tanstack/react-router'
import ChatBridgeWorkspace from '@/components/settings/ChatBridgeWorkspace'

export const Route = createFileRoute('/settings/chatbridge')({
  component: RouteComponent,
})

export function RouteComponent() {
  return <ChatBridgeWorkspace />
}
