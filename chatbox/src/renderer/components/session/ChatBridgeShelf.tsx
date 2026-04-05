import { ActionIcon, Alert, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconAlertCircle, IconApps, IconChevronDown, IconChevronRight, IconExternalLink, IconLock } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { revokeChatBridgeOAuthToken, startChatBridgeOAuthFlow, useChatBridgeOAuthStatus } from '@/packages/chatbridge/oauth'
import { type ChatBridgeAppDefinition, useApprovedChatBridgeAppsForClass } from '@/packages/chatbridge/registry'
import { activateBridgeApp, closeBridgeApp, getSessionBridgeState, updateBridgeAppContext } from '@/packages/chatbridge/session'

type ChatBridgeShelfProps = {
  session: Session
}

type ChatBridgeShelfCardProps = {
  app: ChatBridgeAppDefinition
  session: Session
  isActive: boolean
}

function ChatBridgeShelfCard({ app, session, isActive }: ChatBridgeShelfCardProps) {
  const { data: oauthStatus } = useChatBridgeOAuthStatus(app.appId, app.authType === 'oauth2')
  const isConnected = oauthStatus?.connected

  return (
    <Card withBorder radius="md" p="xs">
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
            <Badge size="xs" leftSection={<IconLock size={10} />} variant="outline" color={isConnected ? 'green' : 'gray'}>
              {isConnected ? 'Connected' : 'OAuth'}
            </Badge>
          ) : (
            <Badge size="xs" leftSection={<IconExternalLink size={10} />} variant="outline">
              {app.authType === 'none' ? 'No Auth' : 'API Key'}
            </Badge>
          )}
        </Group>

        <Group grow>
          {app.authType === 'oauth2' && !isConnected ? (
            <Button
              size="compact-sm"
              variant="filled"
              onClick={() =>
                void startChatBridgeOAuthFlow(app.appId, session.id)
                  .then(() =>
                    updateBridgeAppContext(session.id, app.appId, {
                      status: 'ready',
                      summary: `${app.name} is connected and ready to use.`,
                      lastError: undefined,
                    })
                  )
                  .catch((error) => {
                    console.warn('Failed to start ChatBridge OAuth flow', error)
                  })
              }
            >
              Connect
            </Button>
          ) : (
            <Button
              size="compact-sm"
              variant={isActive ? 'light' : 'filled'}
              onClick={() => void activateBridgeApp(session.id, app.appId)}
            >
              {isActive ? 'Resume App' : 'Open App'}
            </Button>
          )}

          {app.authType === 'oauth2' && isConnected ? (
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() =>
                void revokeChatBridgeOAuthToken(app.appId)
                  .then(() =>
                    updateBridgeAppContext(session.id, app.appId, {
                      status: 'idle',
                      summary: `${app.name} was disconnected.`,
                      lastError: undefined,
                    })
                  )
                  .then(() => {
                    if (isActive) {
                      return closeBridgeApp(session.id)
                    }
                  })
                  .catch((error) => {
                    console.warn('Failed to revoke ChatBridge OAuth token', error)
                  })
              }
            >
              Disconnect
            </Button>
          ) : null}
        </Group>
      </Stack>
    </Card>
  )
}

export default function ChatBridgeShelf({ session }: ChatBridgeShelfProps) {
  const bridgeState = useMemo(() => getSessionBridgeState(session), [session])
  const { data: apps = [], error } = useApprovedChatBridgeAppsForClass(bridgeState.activeClassId)
  const [expanded, setExpanded] = useState(false)

  return (
    <Card withBorder radius="lg" p="sm" className="mx-3 mt-3 sm:mx-4">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Group gap={8} align="flex-start" className="flex-1">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={expanded ? 'Collapse ChatBridge app shelf' : 'Expand ChatBridge app shelf'}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <div>
              <IconApps size={16} />
              <Text fw={700}>ChatBridge App Shelf</Text>
              <Text c="dimmed" size="xs" mt={2}>
                Approved apps for this class, ready to launch inside TutorMeAI.
              </Text>
            </div>
          </Group>
          <Badge size="sm" variant="light">
            {bridgeState.activeClassId}
          </Badge>
        </Group>

        {expanded ? (
          error ? (
            <Alert radius="md" icon={<IconAlertCircle size={16} />} color="red" variant="light">
              ChatBridge apps could not be loaded from the backend right now.
            </Alert>
          ) : (
            <div className="grid gap-2 lg:grid-cols-3">
              {apps.map((app) => (
                <ChatBridgeShelfCard
                  key={app.appId}
                  app={app}
                  session={session}
                  isActive={bridgeState.activeAppId === app.appId}
                />
              ))}
            </div>
          )
        ) : null}
      </Stack>
    </Card>
  )
}
