import { ActionIcon, Alert, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { IconChecklist, IconChevronDown, IconChevronRight, IconShieldCheck, IconSparkles } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import {
  disableChatBridgeAppForClass,
  enableChatBridgeAppForClass,
  registerChatBridgeApp,
  reviewChatBridgeApp,
  useChatBridgeAllowlist,
  useChatBridgeApps,
} from '@/packages/chatbridge/registry'
import { getSessionBridgeState } from '@/packages/chatbridge/session'

type ChatBridgeControlPanelProps = {
  session: Session
}

const DEMO_STORY_BUILDER_MANIFEST = {
  appId: 'story-builder',
  name: 'AI Story Builder',
  version: '1.0.0',
  description: 'Structured storytelling workspace that keeps TutorMeAI in charge of prompting and guardrails.',
  developerName: 'ChatBridge Demo',
  executionModel: 'iframe' as const,
  launchUrl: 'https://apps.chatbridge.local/story-builder',
  allowedOrigins: ['https://apps.chatbridge.local'],
  authType: 'none' as const,
  subjectTags: ['ELA', 'Creative Writing'],
  gradeBand: '3-8',
  llmSafeFields: ['storyTitle', 'chapterCount', 'draftStatus'],
  tools: [
    {
      name: 'chatbridge_story_builder_open',
      description: 'Open the structured AI story builder for the current student.',
    },
  ],
}

const DEFAULT_TEACHER_ID = 'teacher-demo'
const DEFAULT_REVIEWER_ID = 'platform-admin'

export default function ChatBridgeControlPanel({ session }: ChatBridgeControlPanelProps) {
  const bridgeState = useMemo(() => getSessionBridgeState(session), [session])
  const classId = bridgeState.activeClassId
  const { data: apps = [] } = useChatBridgeApps()
  const { data: allowlist = [] } = useChatBridgeAllowlist(classId)
  const [expanded, setExpanded] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  const enabledAppIds = useMemo(
    () => new Set(allowlist.filter((entry) => !entry.disabledAt).map((entry) => entry.appId)),
    [allowlist]
  )

  const registerMutation = useMutation({
    mutationFn: () => registerChatBridgeApp(DEMO_STORY_BUILDER_MANIFEST),
    onSuccess: (app) => {
      setErrorMessage(undefined)
      setStatusMessage(`${app.name} was submitted for platform review.`)
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('Story Builder registration failed. Check that the ChatBridge backend is running.')
    },
  })

  const reviewMutation = useMutation({
    mutationFn: (input: { appId: string; reviewState: 'approved' | 'suspended'; appName: string }) =>
      reviewChatBridgeApp(input.appId, {
        reviewState: input.reviewState,
        reviewerId: DEFAULT_REVIEWER_ID,
        reviewNotes:
          input.reviewState === 'approved'
            ? 'Approved from the TutorMeAI session control panel.'
            : 'Temporarily suspended from the TutorMeAI session control panel.',
      }).then(() => input),
    onSuccess: (input) => {
      setErrorMessage(undefined)
      setStatusMessage(
        input.reviewState === 'approved'
          ? `${input.appName} is now platform-approved.`
          : `${input.appName} was suspended at the platform level.`
      )
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('Platform review update failed. The backend may be unavailable.')
    },
  })

  const allowlistMutation = useMutation({
    mutationFn: (input: { appId: string; enabled: boolean; appName: string }) =>
      (input.enabled
        ? enableChatBridgeAppForClass(classId, input.appId, DEFAULT_TEACHER_ID)
        : disableChatBridgeAppForClass(classId, input.appId, DEFAULT_TEACHER_ID)
      ).then(() => input),
    onSuccess: (input) => {
      setErrorMessage(undefined)
      setStatusMessage(
        input.enabled
          ? `${input.appName} is now enabled for ${classId}.`
          : `${input.appName} is no longer enabled for ${classId}.`
      )
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('Class allowlist update failed. The backend may be unavailable.')
    },
  })

  const storyBuilderApp = apps.find((app) => app.appId === DEMO_STORY_BUILDER_MANIFEST.appId)

  return (
    <Card withBorder radius="lg" p="sm" className="mx-3 mt-3 sm:mx-4">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Group gap={8} align="flex-start" className="flex-1">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={expanded ? 'Collapse ChatBridge control plane' : 'Expand ChatBridge control plane'}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <div>
              <IconShieldCheck size={16} />
              <Text fw={700}>ChatBridge Control Plane</Text>
              <Text c="dimmed" size="xs" mt={2}>
                Review apps and manage class availability without leaving the session.
              </Text>
            </div>
          </Group>
          <Badge size="sm" variant="light">
            {classId}
          </Badge>
        </Group>

        {statusMessage ? (
          <Alert color="green" variant="light" py={8}>
            {statusMessage}
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert color="red" variant="light" py={8}>
            {errorMessage}
          </Alert>
        ) : null}

        {expanded ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card withBorder radius="md" p="sm">
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Group gap={8}>
                    <IconSparkles size={15} />
                    <Text fw={600} size="sm">
                      Developer/Admin
                    </Text>
                  </Group>
                  <Button
                    size="compact-xs"
                    variant="light"
                    loading={registerMutation.isPending}
                    disabled={!!storyBuilderApp}
                    onClick={() => registerMutation.mutate()}
                  >
                    {storyBuilderApp ? 'Registered' : 'Register Story Builder'}
                  </Button>
                </Group>

                <Text size="xs" c="dimmed">
                  Submit a demo manifest, then approve or suspend apps from backend truth.
                </Text>

                <Stack gap={6}>
                  {apps.map((app) => {
                    const nextReviewState = app.reviewState === 'approved' ? 'suspended' : 'approved'
                    const reviewLabel = app.reviewState === 'approved' ? 'Suspend' : 'Approve'

                    return (
                      <div
                        key={app.appId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-black/10 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <Text fw={500} size="sm" truncate>
                            {app.name}
                          </Text>
                          <Group gap={6} mt={4}>
                            <Badge size="xs" variant="light">
                              {app.reviewState}
                            </Badge>
                            <Badge size="xs" variant="outline">
                              {app.executionModel}
                            </Badge>
                          </Group>
                        </div>

                        <Button
                          size="compact-xs"
                          variant="subtle"
                          loading={reviewMutation.isPending && reviewMutation.variables?.appId === app.appId}
                          onClick={() =>
                            reviewMutation.mutate({
                              appId: app.appId,
                              appName: app.name,
                              reviewState: nextReviewState,
                            })
                          }
                        >
                          {reviewLabel}
                        </Button>
                      </div>
                    )
                  })}
                </Stack>
              </Stack>
            </Card>

            <Card withBorder radius="md" p="sm">
              <Stack gap="xs">
                <Group gap={8}>
                  <IconChecklist size={15} />
                  <Text fw={600} size="sm">
                    Teacher Allowlist
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  Enable only approved apps for this class. The shelf and model tool exposure follow these settings.
                </Text>

                <Stack gap={6}>
                  {apps
                    .filter((app) => app.reviewState === 'approved')
                    .map((app) => {
                      const isEnabled = enabledAppIds.has(app.appId)

                      return (
                        <div
                          key={app.appId}
                          className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-black/10 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <Text fw={500} size="sm" truncate>
                              {app.name}
                            </Text>
                            <Text size="xs" c="dimmed" truncate>
                              {isEnabled ? 'Enabled for students in this class.' : 'Not enabled for this class yet.'}
                            </Text>
                          </div>

                          <Button
                            size="compact-xs"
                            variant={isEnabled ? 'light' : 'filled'}
                            loading={allowlistMutation.isPending && allowlistMutation.variables?.appId === app.appId}
                            onClick={() =>
                              allowlistMutation.mutate({
                                appId: app.appId,
                                appName: app.name,
                                enabled: !isEnabled,
                              })
                            }
                          >
                            {isEnabled ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      )
                    })}
                </Stack>
              </Stack>
            </Card>
          </div>
        ) : null}
      </Stack>
    </Card>
  )
}
