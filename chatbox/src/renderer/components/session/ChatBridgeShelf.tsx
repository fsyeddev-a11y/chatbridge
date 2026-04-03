import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconApps, IconExternalLink, IconLock } from '@tabler/icons-react'
import { useMemo } from 'react'
import { useApprovedChatBridgeAppsForClass } from '@/packages/chatbridge/registry'
import { activateBridgeApp, getSessionBridgeState } from '@/packages/chatbridge/session'

type ChatBridgeShelfProps = {
  session: Session
}

export default function ChatBridgeShelf({ session }: ChatBridgeShelfProps) {
  const bridgeState = useMemo(() => getSessionBridgeState(session), [session])
  const { data: apps = [] } = useApprovedChatBridgeAppsForClass(bridgeState.activeClassId)

  return (
    <Card withBorder radius="lg" p="sm" className="mx-3 mt-3 sm:mx-4">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap={8}>
              <IconApps size={16} />
              <Text fw={700}>ChatBridge App Shelf</Text>
            </Group>
            <Text c="dimmed" size="xs" mt={2}>
              Approved apps for this class, ready to launch inside TutorMeAI.
            </Text>
          </div>
          <Badge size="sm" variant="light">
            {bridgeState.activeClassId}
          </Badge>
        </Group>

        <div className="grid gap-2 lg:grid-cols-3">
          {apps.map((app) => {
            const isActive = bridgeState.activeAppId === app.appId
            return (
              <Card key={app.appId} withBorder radius="md" p="xs">
                <Stack gap={6}>
                  <Group justify="space-between" align="center">
                    <Text fw={600} size="sm">
                      {app.name}
                    </Text>
                    <Badge size="xs" variant={isActive ? 'filled' : 'light'}>
                      {isActive ? 'Active' : 'Approved'}
                    </Badge>
                  </Group>

                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {app.description}
                  </Text>

                  <Group gap={6}>
                    <Badge size="xs" variant="outline">
                      {app.executionModel}
                    </Badge>
                    {app.authType === 'oauth2' ? (
                      <Badge size="xs" leftSection={<IconLock size={10} />} variant="outline">
                        OAuth
                      </Badge>
                    ) : (
                      <Badge size="xs" leftSection={<IconExternalLink size={10} />} variant="outline">
                        {app.authType === 'none' ? 'No Auth' : 'API Key'}
                      </Badge>
                    )}
                  </Group>

                  <Button
                    size="compact-sm"
                    variant={isActive ? 'light' : 'filled'}
                    onClick={() => void activateBridgeApp(session.id, app.appId)}
                  >
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
