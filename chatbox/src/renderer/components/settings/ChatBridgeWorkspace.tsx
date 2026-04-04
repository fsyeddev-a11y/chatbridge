import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { IconChecklist, IconHistory, IconShieldCheck, IconSparkles } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import {
  DEFAULT_REVIEWER_ID,
  DEFAULT_TEACHER_ID,
  DEMO_STORY_BUILDER_MANIFEST,
} from '@/packages/chatbridge/control-plane'
import {
  disableChatBridgeAppForClass,
  enableChatBridgeAppForClass,
  registerChatBridgeApp,
  reviewChatBridgeApp,
  useChatBridgeAllowlist,
  useChatBridgeApps,
  useChatBridgeReviewActions,
} from '@/packages/chatbridge/registry'

type ReviewFilter = 'all' | 'pending' | 'approved' | 'suspended' | 'rejected'

const REVIEW_FILTERS: Array<{ label: string; value: ReviewFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Rejected', value: 'rejected' },
]

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return 'Not recorded'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

export default function ChatBridgeWorkspace() {
  const [classId, setClassId] = useState('demo-class')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [statusMessage, setStatusMessage] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  const { data: apps = [] } = useChatBridgeApps()
  const { data: allowlist = [] } = useChatBridgeAllowlist(classId)
  const { data: reviewActions = [] } = useChatBridgeReviewActions()

  const enabledAppIds = useMemo(
    () => new Set(allowlist.filter((entry) => !entry.disabledAt).map((entry) => entry.appId)),
    [allowlist]
  )

  const visibleApps = useMemo(
    () => apps.filter((app) => reviewFilter === 'all' || app.reviewState === reviewFilter),
    [apps, reviewFilter]
  )

  const reviewHistory = useMemo(
    () => [...reviewActions].sort((left, right) => right.timestamp - left.timestamp).slice(0, 8),
    [reviewActions]
  )

  const registerMutation = useMutation({
    mutationFn: () => registerChatBridgeApp(DEMO_STORY_BUILDER_MANIFEST),
    onSuccess: (app) => {
      setErrorMessage(undefined)
      setStatusMessage(`${app.name} was submitted for platform review.`)
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('Story Builder registration failed. Check that the ChatBridge backend is available.')
    },
  })

  const reviewMutation = useMutation({
    mutationFn: (input: { appId: string; reviewState: 'approved' | 'suspended' | 'rejected'; appName: string }) =>
      reviewChatBridgeApp(input.appId, {
        reviewState: input.reviewState,
        reviewerId: DEFAULT_REVIEWER_ID,
        reviewNotes:
          input.reviewState === 'approved'
            ? 'Approved from the ChatBridge settings workspace.'
            : input.reviewState === 'rejected'
              ? 'Rejected from the ChatBridge settings workspace.'
              : 'Suspended from the ChatBridge settings workspace.',
      }).then(() => input),
    onSuccess: (input) => {
      setErrorMessage(undefined)
      setStatusMessage(`${input.appName} review status updated to ${input.reviewState}.`)
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('Review update failed. The backend may be unavailable.')
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
        input.enabled ? `${input.appName} enabled for ${classId}.` : `${input.appName} disabled for ${classId}.`
      )
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('Class allowlist update failed. The backend may be unavailable.')
    },
  })

  const storyBuilderApp = apps.find((app) => app.appId === DEMO_STORY_BUILDER_MANIFEST.appId)

  return (
    <Stack gap="lg" p="md">
      <div>
        <Title order={4}>ChatBridge Workspace</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Review app submissions, manage class availability, and inspect recent governance history outside a live chat.
        </Text>
      </div>

      {statusMessage ? <Alert color="green">{statusMessage}</Alert> : null}
      {errorMessage ? <Alert color="red">{errorMessage}</Alert> : null}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Group gap={8}>
                <IconShieldCheck size={16} />
                <Title order={5}>Admin Registry Review</Title>
              </Group>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconSparkles size={14} />}
                disabled={!!storyBuilderApp}
                loading={registerMutation.isPending}
                onClick={() => registerMutation.mutate()}
              >
                {storyBuilderApp ? 'Story Builder Registered' : 'Register Story Builder'}
              </Button>
            </Group>

            <SegmentedControl
              fullWidth
              size="xs"
              data={REVIEW_FILTERS}
              value={reviewFilter}
              onChange={(value) => setReviewFilter(value as ReviewFilter)}
            />

            <Stack gap="sm">
              {visibleApps.map((app) => (
                <Card key={app.appId} withBorder radius="md" p="sm">
                  <Stack gap={8}>
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={600}>{app.name}</Text>
                        <Text size="xs" c="dimmed">
                          {app.description}
                        </Text>
                      </div>
                      <Group gap={6}>
                        <Badge size="sm" variant="light">
                          {app.reviewState}
                        </Badge>
                        <Badge size="sm" variant="outline">
                          {app.executionModel}
                        </Badge>
                      </Group>
                    </Group>

                    <Text size="xs" c="dimmed">
                      {app.appId} • v{app.version} • {app.developerName}
                    </Text>

                    <Group gap={8}>
                      <Button
                        size="compact-sm"
                        variant={app.reviewState === 'approved' ? 'filled' : 'light'}
                        disabled={app.reviewState === 'approved'}
                        loading={reviewMutation.isPending && reviewMutation.variables?.appId === app.appId}
                        onClick={() =>
                          reviewMutation.mutate({
                            appId: app.appId,
                            appName: app.name,
                            reviewState: 'approved',
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="light"
                        color="yellow"
                        disabled={app.reviewState === 'suspended'}
                        loading={reviewMutation.isPending && reviewMutation.variables?.appId === app.appId}
                        onClick={() =>
                          reviewMutation.mutate({
                            appId: app.appId,
                            appName: app.name,
                            reviewState: 'suspended',
                          })
                        }
                      >
                        Suspend
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="red"
                        disabled={app.reviewState === 'rejected'}
                        loading={reviewMutation.isPending && reviewMutation.variables?.appId === app.appId}
                        onClick={() =>
                          reviewMutation.mutate({
                            appId: app.appId,
                            appName: app.name,
                            reviewState: 'rejected',
                          })
                        }
                      >
                        Reject
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ))}

              {!visibleApps.length ? (
                <Text size="sm" c="dimmed">
                  No apps match the current review filter.
                </Text>
              ) : null}
            </Stack>
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Group gap={8}>
              <IconChecklist size={16} />
              <Title order={5}>Teacher Class Allowlist</Title>
            </Group>

            <TextInput
              label="Class ID"
              value={classId}
              onChange={(event) => setClassId(event.currentTarget.value.trim() || 'demo-class')}
              description="Manage which approved apps are available to a class without opening a student session."
            />

            <Stack gap="sm">
              {apps.map((app) => {
                const allowlistEntry = allowlist.find((entry) => entry.appId === app.appId && !entry.disabledAt)
                const isEnabled = enabledAppIds.has(app.appId)
                const isReviewApproved = app.reviewState === 'approved'

                return (
                  <Card key={app.appId} withBorder radius="md" p="sm">
                    <Stack gap={8}>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text fw={600}>{app.name}</Text>
                          <Text size="xs" c="dimmed">
                            {isReviewApproved
                              ? isEnabled
                                ? `Enabled by ${allowlistEntry?.enabledBy || 'teacher'} on ${formatTimestamp(allowlistEntry?.enabledAt)}`
                                : `Approved but not enabled for ${classId}.`
                              : `${app.reviewState} at the platform level.`}
                          </Text>
                        </div>
                        <Badge size="sm" variant={isReviewApproved ? 'light' : 'outline'} color={isReviewApproved ? 'blue' : 'gray'}>
                          {app.reviewState}
                        </Badge>
                      </Group>

                      <Button
                        size="compact-sm"
                        variant={isEnabled ? 'light' : 'filled'}
                        disabled={!isReviewApproved}
                        loading={allowlistMutation.isPending && allowlistMutation.variables?.appId === app.appId}
                        onClick={() =>
                          allowlistMutation.mutate({
                            appId: app.appId,
                            appName: app.name,
                            enabled: !isEnabled,
                          })
                        }
                      >
                        {isEnabled ? 'Disable for Class' : 'Enable for Class'}
                      </Button>
                    </Stack>
                  </Card>
                )
              })}
            </Stack>
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Group gap={8}>
            <IconHistory size={16} />
            <Title order={5}>Recent Review History</Title>
          </Group>
          <Stack gap="sm">
            {reviewHistory.length ? (
              reviewHistory.map((action) => (
                <Card key={`${action.appId}-${action.timestamp}-${action.action}`} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text fw={600}>
                        {action.appId} • {action.action}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Reviewer {action.reviewerId} • v{action.version} • {formatTimestamp(action.timestamp)}
                      </Text>
                      {action.notes ? (
                        <Text size="sm" mt={6}>
                          {action.notes}
                        </Text>
                      ) : null}
                    </div>
                    <Badge size="sm" variant="outline">
                      {action.action}
                    </Badge>
                  </Group>
                </Card>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                No review actions recorded yet.
              </Text>
            )}
          </Stack>
        </Stack>
      </Card>
    </Stack>
  )
}
