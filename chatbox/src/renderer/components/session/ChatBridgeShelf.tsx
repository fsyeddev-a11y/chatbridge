import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconApps, IconExternalLink, IconLock } from '@tabler/icons-react'
import { useMemo } from 'react'
import { getApprovedChatBridgeAppsForClass } from '@/packages/chatbridge/registry'
import { activateBridgeApp, getSessionBridgeState } from '@/packages/chatbridge/session'

type ChatBridgeShelfProps = {
  session: Session
}

export default function ChatBridgeShelf({ session }: ChatBridgeShelfProps) {
  const bridgeState = useMemo(() => getSessionBridgeState(session), [session])
  const apps = useMemo(
    () => getApprovedChatBridgeAppsForClass(bridgeState.activeClassId),
    [bridgeState.activeClassId]
  )

  return (
    <Card withBorder radius="lg" p="md" className="mx-3 mt-3 sm:mx-4">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap={8}>
              <IconApps size={18} />
              <Text fw={700}>ChatBridge App Shelf</Text>
            </Group>
            <Text c="dimmed" size="sm" mt={4}>
              Approved apps for this class can be launched inside TutorMeAI without exposing the host app to
              third-party code.
            </Text>
          </div>
          <Badge variant="light">{bridgeState.activeClassId}</Badge>
        </Group>

        <div className="grid gap-3 md:grid-cols-3">
          {apps.map((app) => {
            const isActive = bridgeState.activeAppId === app.appId
            return (
              <Card key={app.appId} withBorder radius="md" p="sm">
                <Stack gap={8}>
                  <Group justify="space-between" align="center">
                    <Text fw={600}>{app.name}</Text>
                    <Badge variant={isActive ? 'filled' : 'light'}>{isActive ? 'Active' : 'Approved'}</Badge>
                  </Group>

                  <Text size="sm" c="dimmed">
                    {app.description}
                  </Text>

                  <Group gap={8}>
                    <Badge variant="outline">{app.executionModel}</Badge>
                    {app.authType === 'oauth2' ? (
                      <Badge leftSection={<IconLock size={12} />} variant="outline">
                        OAuth
                      </Badge>
                    ) : (
                      <Badge leftSection={<IconExternalLink size={12} />} variant="outline">
                        {app.authType === 'none' ? 'No Auth' : 'API Key'}
                      </Badge>
                    )}
                  </Group>

                  <Button variant={isActive ? 'light' : 'filled'} onClick={() => void activateBridgeApp(session.id, app.appId)}>
                    {isActive ? 'Resume App' : 'Open App'}
                  </Button>
                </Stack>
              </Card>
            )
          })}
        </div>
      </Stack>
    </Card>
  )
}
