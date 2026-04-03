import { Alert, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconAlertCircle, IconCheck, IconPlayerPause } from '@tabler/icons-react'
import { useEffect, useMemo, useRef } from 'react'
import { emitChatBridgeEvent } from '@/packages/chatbridge/observability'
import { resolveBridgeEnvelope } from '@/packages/chatbridge/panel-runtime'
import { getChatBridgeAppById, getChatBridgeMockSrcDoc } from '@/packages/chatbridge/registry'
import { closeBridgeApp, getSessionBridgeState, updateBridgeAppContext } from '@/packages/chatbridge/session'

type ChatBridgePanelProps = {
  session: Session
}

export default function ChatBridgePanel({ session }: ChatBridgePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeState = useMemo(() => getSessionBridgeState(session), [session])
  const activeApp = useMemo(() => getChatBridgeAppById(bridgeState.activeAppId), [bridgeState.activeAppId])
  const activeContext = activeApp ? bridgeState.appContext[activeApp.appId] : undefined

  useEffect(() => {
    if (!activeApp) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      const resolution = resolveBridgeEnvelope(activeApp, event.data, event.origin)

      if (!resolution.accepted) {
        emitChatBridgeEvent({
          name: 'AppStateRejected',
          payload: {
            traceId: `chatbridge-panel-${session.id}`,
            sessionId: session.id,
            classId: bridgeState.activeClassId,
            activeAppId: activeApp.appId,
            appId: activeApp.appId,
            reason: resolution.reason,
            messageType: resolution.eventPayload?.messageType,
          },
        })
        return
      }

      emitChatBridgeEvent({
        name: resolution.eventName,
        payload: {
          traceId: `chatbridge-panel-${session.id}`,
          sessionId: session.id,
          classId: bridgeState.activeClassId,
          activeAppId: activeApp.appId,
          appId: activeApp.appId,
          messageType: resolution.eventPayload?.messageType,
          error: resolution.eventPayload?.error,
        },
      })

      void updateBridgeAppContext(session.id, activeApp.appId, resolution.nextState)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [activeApp, session.id])

  if (!activeApp) {
    return null
  }

  const srcDoc = getChatBridgeMockSrcDoc(activeApp)

  return (
    <Card withBorder radius="lg" p="md" className="mx-3 mt-3 sm:mx-4">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap={8}>
              <Text fw={700}>{activeApp.name}</Text>
              <Badge variant="light">{activeContext?.status || 'active'}</Badge>
            </Group>
            <Text c="dimmed" size="sm" mt={4}>
              Bridge-owned app runtime. The iframe can send state, but TutorMeAI decides what is stored and what reaches
              the model.
            </Text>
          </div>
          <Button
            variant="subtle"
            color="gray"
            onClick={() => {
              emitChatBridgeEvent({
                name: 'AppClosed',
                payload: {
                  traceId: `chatbridge-panel-${session.id}`,
                  sessionId: session.id,
                  classId: bridgeState.activeClassId,
                  activeAppId: activeApp.appId,
                  appId: activeApp.appId,
                  reason: 'user_closed',
                },
              })
              void closeBridgeApp(session.id)
            }}
          >
            Close App
          </Button>
        </Group>

        {activeContext?.summary ? (
          <Alert radius="md" icon={<IconCheck size={16} />} color="blue" variant="light">
            {activeContext.summary}
          </Alert>
        ) : (
          <Alert radius="md" icon={<IconPlayerPause size={16} />} color="gray" variant="light">
            No Bridge-authored summary yet. Launch the app and send a ready or state event to populate `appContext`.
          </Alert>
        )}

        {activeContext?.lastError ? (
          <Alert radius="md" icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {activeContext.lastError}
          </Alert>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <iframe
            ref={iframeRef}
            title={`${activeApp.name} iframe`}
            className="h-[280px] w-full bg-white"
            sandbox="allow-scripts allow-forms allow-popups"
            src={srcDoc ? undefined : activeApp.launchUrl}
            srcDoc={srcDoc}
          />
        </div>
      </Stack>
    </Card>
  )
}
