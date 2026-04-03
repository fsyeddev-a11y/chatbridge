import { Alert, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconAlertCircle, IconCheck, IconPlayerPause } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { emitChatBridgeEvent } from '@/packages/chatbridge/observability'
import {
  getBridgeFailureMessage,
  getHeartbeatIntervalMs,
  getHeartbeatTimeoutMs,
  getIframeSandboxPolicy,
  postHostBridgeMessage,
  resolveBridgeEnvelope,
  shouldSendHeartbeatPing,
} from '@/packages/chatbridge/panel-runtime'
import { getChatBridgeMockSrcDoc, useChatBridgeApps } from '@/packages/chatbridge/registry'
import { activateBridgeApp, closeBridgeApp, getSessionBridgeState, updateBridgeAppContext } from '@/packages/chatbridge/session'

type ChatBridgePanelProps = {
  session: Session
}

export default function ChatBridgePanel({ session }: ChatBridgePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const initSentRef = useRef(false)
  const startupTimeoutRef = useRef<number | null>(null)
  const awaitingHeartbeatRef = useRef(false)
  const heartbeatMissesRef = useRef(0)
  const latestRuntimeStatusRef = useRef<string | undefined>(undefined)
  const bridgeState = useMemo(() => getSessionBridgeState(session), [session])
  const { data: apps = [] } = useChatBridgeApps()
  const activeApp = useMemo(
    () => apps.find((app) => app.appId === bridgeState.activeAppId),
    [apps, bridgeState.activeAppId]
  )
  const activeContext = activeApp ? bridgeState.appContext[activeApp.appId] : undefined
  const traceId = `chatbridge-panel-${session.id}`

  latestRuntimeStatusRef.current = activeContext?.status

  useEffect(() => {
    initSentRef.current = false
    awaitingHeartbeatRef.current = false
    heartbeatMissesRef.current = 0
    if (startupTimeoutRef.current) {
      window.clearTimeout(startupTimeoutRef.current)
      startupTimeoutRef.current = null
    }
  }, [activeApp?.appId])

  useEffect(() => {
    return () => {
      if (startupTimeoutRef.current) {
        window.clearTimeout(startupTimeoutRef.current)
        startupTimeoutRef.current = null
      }
    }
  }, [])

  const handleAppFailure = useCallback((reason: 'startup_timeout' | 'heartbeat_timeout') => {
    if (!activeApp) {
      return
    }

    awaitingHeartbeatRef.current = false
    heartbeatMissesRef.current = 0
    if (startupTimeoutRef.current) {
      window.clearTimeout(startupTimeoutRef.current)
      startupTimeoutRef.current = null
    }

    postHostBridgeMessage(iframeRef.current, activeApp, 'TERMINATE', {
      reason,
    })

    emitChatBridgeEvent({
      name: reason === 'startup_timeout' ? 'AppStartupTimedOut' : 'AppHeartbeatTimedOut',
      payload: {
        traceId,
        sessionId: session.id,
        classId: bridgeState.activeClassId,
        activeAppId: activeApp.appId,
        appId: activeApp.appId,
        reason,
      },
    })

    void updateBridgeAppContext(session.id, activeApp.appId, {
      status: 'error',
      summary: activeContext?.summary,
      lastState: activeContext?.lastState,
      lastError: getBridgeFailureMessage(reason),
    })
  }, [activeApp, activeContext?.lastState, activeContext?.summary, bridgeState.activeClassId, session.id, traceId])

  useEffect(() => {
    if (!activeApp) {
      return
    }

    const interval = window.setInterval(() => {
      if (!initSentRef.current || !shouldSendHeartbeatPing(latestRuntimeStatusRef.current)) {
        return
      }

      if (awaitingHeartbeatRef.current) {
        heartbeatMissesRef.current += 1
        if (heartbeatMissesRef.current >= 2) {
          handleAppFailure('heartbeat_timeout')
          return
        }
      }

      const result = postHostBridgeMessage(iframeRef.current, activeApp, 'PING')
      if (!result.sent) {
        return
      }

      awaitingHeartbeatRef.current = true
      emitChatBridgeEvent({
        name: 'AppPingSent',
        payload: {
          traceId,
          sessionId: session.id,
          classId: bridgeState.activeClassId,
          activeAppId: activeApp.appId,
          appId: activeApp.appId,
        },
      })
    }, getHeartbeatIntervalMs(activeApp))

    return () => window.clearInterval(interval)
  }, [activeApp, bridgeState.activeClassId, handleAppFailure, session.id, traceId])

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
            traceId,
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
          traceId,
          sessionId: session.id,
          classId: bridgeState.activeClassId,
          activeAppId: activeApp.appId,
          appId: activeApp.appId,
          messageType: resolution.eventPayload?.messageType,
          error: resolution.eventPayload?.error,
        },
      })

      if (resolution.eventName === 'AppReadyReceived') {
        if (startupTimeoutRef.current) {
          window.clearTimeout(startupTimeoutRef.current)
          startupTimeoutRef.current = null
        }
      }

      if (resolution.eventName === 'AppHeartbeatReceived') {
        awaitingHeartbeatRef.current = false
        heartbeatMissesRef.current = 0
      }

      void updateBridgeAppContext(session.id, activeApp.appId, resolution.nextState)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [activeApp, bridgeState.activeClassId, session.id, traceId])

  if (!activeApp) {
    return null
  }

  const srcDoc = getChatBridgeMockSrcDoc(activeApp)
  const iframeSandbox = getIframeSandboxPolicy(activeApp, srcDoc)

  const sendInitMessage = () => {
    if (!activeApp) {
      return
    }

    const result = postHostBridgeMessage(iframeRef.current, activeApp, 'INIT', {
      sessionId: session.id,
      classId: bridgeState.activeClassId,
      locale: navigator.language || 'en-US',
      theme: document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark' ? 'dark' : 'light',
      previousState: activeContext?.lastState,
    })

    if (!result.sent) {
      return
    }

    initSentRef.current = true
    if (startupTimeoutRef.current) {
      window.clearTimeout(startupTimeoutRef.current)
    }
    startupTimeoutRef.current = window.setTimeout(() => {
      handleAppFailure('startup_timeout')
    }, getHeartbeatTimeoutMs(activeApp))
    emitChatBridgeEvent({
      name: 'AppInitSent',
      payload: {
        traceId,
        sessionId: session.id,
        classId: bridgeState.activeClassId,
        activeAppId: activeApp.appId,
        appId: activeApp.appId,
      },
    })
  }

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
                name: 'AppTerminateSent',
                payload: {
                  traceId,
                  sessionId: session.id,
                  classId: bridgeState.activeClassId,
                  activeAppId: activeApp.appId,
                  appId: activeApp.appId,
                  reason: 'user_closed',
                },
              })
              postHostBridgeMessage(iframeRef.current, activeApp, 'TERMINATE', {
                reason: 'user_closed',
              })
              emitChatBridgeEvent({
                name: 'AppClosed',
                payload: {
                  traceId,
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
            <Stack gap={8}>
              <Text size="sm">{activeContext.lastError}</Text>
              <Group gap={8}>
                <Button size="xs" variant="light" onClick={() => void activateBridgeApp(session.id, activeApp.appId)}>
                  Reopen App
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={() => void closeBridgeApp(session.id)}>
                  Continue Without App
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : null}

        {activeContext?.status === 'error' ? null : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <iframe
              ref={iframeRef}
              title={`${activeApp.name} iframe`}
              key={activeApp.appId}
              className="h-[280px] w-full bg-white"
              sandbox={iframeSandbox}
              src={srcDoc ? undefined : activeApp.launchUrl}
              srcDoc={srcDoc}
              onLoad={sendInitMessage}
            />
          </div>
        )}
      </Stack>
    </Card>
  )
}
