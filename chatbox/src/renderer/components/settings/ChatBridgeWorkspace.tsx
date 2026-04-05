import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { IconChecklist, IconHistory, IconShieldCheck, IconSparkles } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_REVIEWER_ID,
  DEFAULT_SCHOOL_ADMIN_ID,
  DEFAULT_TEACHER_ID,
  DEMO_STORY_BUILDER_MANIFEST,
} from '@/packages/chatbridge/control-plane'
import {
  disableChatBridgeAppForClass,
  disableChatBridgeAppForSchool,
  enableChatBridgeAppForClass,
  enableChatBridgeAppForSchool,
  fetchDeveloperChatBridgeApps,
  registerChatBridgeApp,
  reviewChatBridgeApp,
  useChatBridgeAllowlist,
  useChatBridgeApps,
  useChatBridgeMe,
  useChatBridgeReviewActions,
  useChatBridgeSchoolAllowlist,
  useDeveloperChatBridgeReviewActions,
  useDeveloperChatBridgeApps,
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

function formatVersionStatus(app: {
  version: string
  activeVersion?: string
  pendingVersion?: string
}) {
  if (app.activeVersion && app.pendingVersion && app.activeVersion !== app.pendingVersion) {
    return `Live v${app.activeVersion} • Pending v${app.pendingVersion}`
  }

  if (app.pendingVersion) {
    return `Pending v${app.pendingVersion}`
  }

  if (app.activeVersion) {
    return `Live v${app.activeVersion}`
  }

  return `v${app.version}`
}

export default function ChatBridgeWorkspace() {
  const [schoolId, setSchoolId] = useState('')
  const [classId, setClassId] = useState('')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [statusMessage, setStatusMessage] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [developerManifestJson, setDeveloperManifestJson] = useState(JSON.stringify(DEMO_STORY_BUILDER_MANIFEST, null, 2))

  const { data: workspaceUser, error: workspaceUserError, isLoading: workspaceUserLoading } = useChatBridgeMe()
  const effectiveRoles = workspaceUser?.user.roles || []
  const schoolMemberships = workspaceUser?.schoolMemberships || []
  const classMemberships = workspaceUser?.classMemberships || workspaceUser?.memberships || []
  const schoolAdminSchoolIds = useMemo(
    () =>
      schoolMemberships
        .filter((membership) => membership.membershipRole === 'school_admin')
        .map((membership) => membership.schoolId),
    [schoolMemberships]
  )
  const teacherClassIds = useMemo(
    () =>
      classMemberships
        .filter((membership) => membership.membershipRole === 'teacher')
        .map((membership) => membership.classId),
    [classMemberships]
  )
  const canUseDeveloperWorkspace = effectiveRoles.includes('developer') || effectiveRoles.includes('admin')
  const canUseAdminWorkspace = effectiveRoles.includes('admin')
  const canUseSchoolAdminWorkspace = canUseAdminWorkspace || schoolAdminSchoolIds.length > 0
  const canUseTeacherWorkspace = canUseAdminWorkspace || teacherClassIds.length > 0

  const managedSchools = useMemo(() => {
    if (!workspaceUser) {
      return []
    }

    if (canUseAdminWorkspace) {
      return workspaceUser.schools
    }

    const allowedSchoolIds = new Set(schoolAdminSchoolIds)
    return workspaceUser.schools.filter((school) => allowedSchoolIds.has(school.schoolId))
  }, [workspaceUser, canUseAdminWorkspace, schoolAdminSchoolIds])

  const manageableClasses = useMemo(() => {
    if (!workspaceUser) {
      return []
    }

    if (canUseAdminWorkspace) {
      return workspaceUser.classes
    }

    const allowedClassIds = new Set(teacherClassIds)
    return workspaceUser.classes.filter((entry) => allowedClassIds.has(entry.classId))
  }, [workspaceUser, canUseAdminWorkspace, teacherClassIds])

  const selectedClass = useMemo(
    () => manageableClasses.find((entry) => entry.classId === classId),
    [manageableClasses, classId]
  )
  const effectiveSchoolId = selectedClass?.schoolId || schoolId

  useEffect(() => {
    if (!schoolId && managedSchools.length) {
      setSchoolId(managedSchools[0].schoolId)
    }
  }, [managedSchools, schoolId])

  useEffect(() => {
    if (!classId && manageableClasses.length) {
      setClassId(manageableClasses[0].classId)
    }
  }, [manageableClasses, classId])

  useEffect(() => {
    if (selectedClass?.schoolId && selectedClass.schoolId !== schoolId) {
      setSchoolId(selectedClass.schoolId)
    }
  }, [selectedClass?.schoolId, schoolId])

  const { data: apps = [], error: appsError } = useChatBridgeApps({
    enabled: canUseAdminWorkspace || canUseTeacherWorkspace || canUseSchoolAdminWorkspace,
  })
  const { data: schoolAllowlist = [], error: schoolAllowlistError } = useChatBridgeSchoolAllowlist(effectiveSchoolId, {
    enabled: canUseSchoolAdminWorkspace || canUseTeacherWorkspace,
  })
  const { data: allowlist = [], error: allowlistError } = useChatBridgeAllowlist(classId, {
    enabled: canUseTeacherWorkspace && !!classId,
  })
  const { data: reviewActions = [], error: reviewActionsError } = useChatBridgeReviewActions({
    enabled: canUseAdminWorkspace,
  })
  const { data: developerApps = [], error: developerAppsError } = useDeveloperChatBridgeApps({
    enabled: canUseDeveloperWorkspace,
  })
  const { data: developerReviewActions = [], error: developerReviewActionsError } = useDeveloperChatBridgeReviewActions({
    enabled: canUseDeveloperWorkspace,
  })

  const schoolEnabledAppIds = useMemo(
    () => new Set(schoolAllowlist.filter((entry) => !entry.disabledAt).map((entry) => entry.appId)),
    [schoolAllowlist]
  )
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
  const developerReviewHistory = useMemo(
    () => [...developerReviewActions].sort((left, right) => right.timestamp - left.timestamp),
    [developerReviewActions]
  )

  const workspaceLoadError =
    workspaceUserError ||
    ((canUseAdminWorkspace || canUseTeacherWorkspace || canUseSchoolAdminWorkspace) ? appsError : undefined) ||
    ((canUseSchoolAdminWorkspace || canUseTeacherWorkspace) && effectiveSchoolId ? schoolAllowlistError : undefined) ||
    (canUseTeacherWorkspace ? allowlistError : undefined) ||
    (canUseAdminWorkspace ? reviewActionsError : undefined) ||
    (canUseDeveloperWorkspace ? developerAppsError : undefined) ||
    (canUseDeveloperWorkspace ? developerReviewActionsError : undefined)

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

  const developerRegisterMutation = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(developerManifestJson)
      return registerChatBridgeApp(parsed)
    },
    onSuccess: async (app) => {
      setErrorMessage(undefined)
      setStatusMessage(`${app.name} was submitted as your developer app.`)
      await fetchDeveloperChatBridgeApps()
    },
    onError: (error) => {
      setStatusMessage(undefined)
      setErrorMessage(error instanceof Error ? error.message : 'Developer manifest submission failed.')
    },
  })

  const reviewMutation = useMutation({
    mutationFn: (input: {
      appId: string
      reviewState: 'approved' | 'suspended' | 'rejected'
      appName: string
      version?: string
    }) =>
      reviewChatBridgeApp(input.appId, {
        reviewState: input.reviewState,
        reviewerId: DEFAULT_REVIEWER_ID,
        version: input.version,
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

  const schoolAllowlistMutation = useMutation({
    mutationFn: (input: { appId: string; enabled: boolean; appName: string }) =>
      (input.enabled
        ? enableChatBridgeAppForSchool(effectiveSchoolId, input.appId, DEFAULT_SCHOOL_ADMIN_ID)
        : disableChatBridgeAppForSchool(effectiveSchoolId, input.appId, DEFAULT_SCHOOL_ADMIN_ID)
      ).then(() => input),
    onSuccess: (input) => {
      setErrorMessage(undefined)
      setStatusMessage(
        input.enabled
          ? `${input.appName} enabled for ${effectiveSchoolId}.`
          : `${input.appName} disabled for ${effectiveSchoolId}.`
      )
    },
    onError: () => {
      setStatusMessage(undefined)
      setErrorMessage('School app approval update failed. The backend may be unavailable.')
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
  const schoolOptions = managedSchools.map((school) => ({
    value: school.schoolId,
    label: school.name,
  }))
  const classOptions = manageableClasses.map((entry) => ({
    value: entry.classId,
    label: entry.schoolId ? `${entry.name} (${entry.classId})` : entry.name,
  }))

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
      {workspaceUserLoading ? <Alert color="blue">Loading your ChatBridge workspace access…</Alert> : null}
      {workspaceLoadError ? (
        <Alert color="red">
          ChatBridge backend data could not be loaded. This workspace no longer falls back to local mock state.
        </Alert>
      ) : null}
      {workspaceUser ? (
        <Group gap={8}>
          {workspaceUser.user.roles.map((role) => (
            <Badge key={role} variant="light">
              {role}
            </Badge>
          ))}
        </Group>
      ) : null}

      {!workspaceUserLoading &&
      !workspaceLoadError &&
      !canUseDeveloperWorkspace &&
      !canUseAdminWorkspace &&
      !canUseSchoolAdminWorkspace &&
      !canUseTeacherWorkspace ? (
        <Alert color="blue">
          This account can use TutorMeAI, but it does not currently have ChatBridge workspace permissions. Sign in as an
          admin, school admin, teacher, or developer to manage apps here.
        </Alert>
      ) : null}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        {canUseDeveloperWorkspace ? (
          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap={8}>
                  <IconSparkles size={16} />
                  <Title order={5}>Developer Portal</Title>
                </Group>
                <Badge variant="light">{developerApps.length} owned</Badge>
              </Group>

              <Text size="sm" c="dimmed">
                Submit a manifest as the currently signed-in developer and track the apps you own.
              </Text>

              <Textarea
                label="Manifest JSON"
                minRows={12}
                autosize
                value={developerManifestJson}
                onChange={(event) => setDeveloperManifestJson(event.currentTarget.value)}
              />

              <Group justify="flex-end">
                <Button loading={developerRegisterMutation.isPending} onClick={() => developerRegisterMutation.mutate()}>
                  Submit Manifest
                </Button>
              </Group>

              <Stack gap="sm">
                {developerApps.map((app) => (
                  <Card key={app.appId} withBorder radius="md" p="sm">
                    <Stack gap={6}>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text fw={600}>{app.name}</Text>
                          <Text size="xs" c="dimmed">
                            {app.appId} • {formatVersionStatus(app)}
                          </Text>
                        </div>
                        <Badge variant="light">{app.reviewState}</Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {app.description}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Owner: {app.ownerEmail || 'Current developer'}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Submitted: {formatTimestamp(app.registeredAt)}
                        {app.reviewedAt ? ` • Reviewed: ${formatTimestamp(app.reviewedAt)}` : ''}
                      </Text>
                      {app.reviewNotes ? (
                        <Alert color={app.reviewState === 'approved' ? 'green' : app.reviewState === 'pending' ? 'blue' : 'yellow'}>
                          Latest feedback: {app.reviewNotes}
                        </Alert>
                      ) : (
                        <Text size="xs" c="dimmed">
                          No review feedback yet. Your app is currently {app.reviewState}.
                        </Text>
                      )}

                      {developerReviewHistory.filter((action) => action.appId === app.appId).length ? (
                        <Stack gap={4}>
                          <Text size="xs" fw={600} c="dimmed">
                            Review history
                          </Text>
                          {developerReviewHistory
                            .filter((action) => action.appId === app.appId)
                            .slice(0, 3)
                            .map((action, index) => (
                              <Text key={`${app.appId}-${action.timestamp}-${index}`} size="xs" c="dimmed">
                                {action.action} • v{action.version} • {formatTimestamp(action.timestamp)}
                                {action.notes ? ` • ${action.notes}` : ''}
                              </Text>
                            ))}
                        </Stack>
                      ) : null}
                    </Stack>
                  </Card>
                ))}

                {!developerApps.length ? (
                  <Text size="sm" c="dimmed">
                    You have not submitted any apps yet.
                  </Text>
                ) : null}
              </Stack>
            </Stack>
          </Card>
        ) : null}

        {canUseAdminWorkspace ? (
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
                        {app.appId} • {formatVersionStatus(app)} • {app.developerName}
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
                              version: app.pendingVersion || app.version,
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
                              version: app.pendingVersion || app.version,
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
                              version: app.pendingVersion || app.version,
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
        ) : null}

        {canUseSchoolAdminWorkspace ? (
          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <Group gap={8}>
                <IconShieldCheck size={16} />
                <Title order={5}>School App Approval</Title>
              </Group>

              <Select
                label="School"
                data={schoolOptions}
                value={effectiveSchoolId || null}
                onChange={(value) => setSchoolId(value || '')}
                placeholder={schoolOptions.length ? 'Select a school' : 'No managed schools'}
                disabled={!schoolOptions.length}
                description="Enable platform-approved apps for a school before teachers can activate them in their classes."
              />

              {!schoolOptions.length ? (
                <Alert color="blue">
                  This account does not currently manage any schools.
                </Alert>
              ) : null}

              <Stack gap="sm">
                {apps.map((app) => {
                  const schoolAllowlistEntry = schoolAllowlist.find((entry) => entry.appId === app.appId && !entry.disabledAt)
                  const isSchoolEnabled = schoolEnabledAppIds.has(app.appId)
                  const isReviewApproved = app.reviewState === 'approved'

                  return (
                    <Card key={app.appId} withBorder radius="md" p="sm">
                      <Stack gap={8}>
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Text fw={600}>{app.name}</Text>
                            <Text size="xs" c="dimmed">
                              {isReviewApproved
                                ? isSchoolEnabled
                                  ? `Enabled for ${effectiveSchoolId} by ${schoolAllowlistEntry?.enabledBy || 'school admin'} on ${formatTimestamp(schoolAllowlistEntry?.enabledAt)}`
                                  : `Approved at the platform level, but not enabled for ${effectiveSchoolId}.`
                                : `${app.reviewState} at the platform level.`}
                            </Text>
                          </div>
                          <Group gap={6}>
                            <Badge size="sm" variant={isReviewApproved ? 'light' : 'outline'} color={isReviewApproved ? 'blue' : 'gray'}>
                              {app.reviewState}
                            </Badge>
                            {isSchoolEnabled ? (
                              <Badge size="sm" variant="light" color="green">
                                School Enabled
                              </Badge>
                            ) : null}
                          </Group>
                        </Group>

                        <Button
                          size="compact-sm"
                          variant={isSchoolEnabled ? 'light' : 'filled'}
                          disabled={!isReviewApproved || !effectiveSchoolId}
                          loading={schoolAllowlistMutation.isPending && schoolAllowlistMutation.variables?.appId === app.appId}
                          onClick={() =>
                            schoolAllowlistMutation.mutate({
                              appId: app.appId,
                              appName: app.name,
                              enabled: !isSchoolEnabled,
                            })
                          }
                        >
                          {isSchoolEnabled ? 'Disable for School' : 'Enable for School'}
                        </Button>
                      </Stack>
                    </Card>
                  )
                })}
              </Stack>
            </Stack>
          </Card>
        ) : null}

        {canUseTeacherWorkspace ? (
          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <Group gap={8}>
                <IconChecklist size={16} />
                <Title order={5}>Teacher Class Allowlist</Title>
              </Group>

              <Select
                label="Class"
                data={classOptions}
                value={classId || null}
                onChange={(value) => setClassId(value || '')}
                placeholder={classOptions.length ? 'Select a class' : 'No managed classes'}
                disabled={!classOptions.length}
                description="Manage which school-approved apps are available to a class without opening a student session."
              />

              {!classOptions.length ? (
                <Alert color="blue">
                  This account does not currently teach any classes.
                </Alert>
              ) : null}

              <Stack gap="sm">
                {apps.map((app) => {
                  const allowlistEntry = allowlist.find((entry) => entry.appId === app.appId && !entry.disabledAt)
                  const isSchoolEnabled = schoolEnabledAppIds.has(app.appId)
                  const isEnabled = enabledAppIds.has(app.appId)
                  const isReviewApproved = app.reviewState === 'approved'
                  const canEnableForClass = isReviewApproved && isSchoolEnabled

                  return (
                    <Card key={app.appId} withBorder radius="md" p="sm">
                      <Stack gap={8}>
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Text fw={600}>{app.name}</Text>
                            <Text size="xs" c="dimmed">
                              {canEnableForClass
                                ? isEnabled
                                  ? `Enabled by ${allowlistEntry?.enabledBy || 'teacher'} on ${formatTimestamp(allowlistEntry?.enabledAt)}`
                                  : `Approved but not enabled for ${classId}.`
                                : isReviewApproved
                                  ? `Approved at the platform level, but not yet enabled for ${effectiveSchoolId}.`
                                : `${app.reviewState} at the platform level.`}
                            </Text>
                          </div>
                          <Group gap={6}>
                            <Badge
                              size="sm"
                              variant={isReviewApproved ? 'light' : 'outline'}
                              color={isReviewApproved ? 'blue' : 'gray'}
                            >
                              {app.reviewState}
                            </Badge>
                            {isSchoolEnabled ? (
                              <Badge size="sm" variant="light" color="green">
                                School Enabled
                              </Badge>
                            ) : null}
                          </Group>
                        </Group>

                        <Button
                          size="compact-sm"
                          variant={isEnabled ? 'light' : 'filled'}
                          disabled={!canEnableForClass || !classId}
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
        ) : null}
      </SimpleGrid>

      {canUseAdminWorkspace ? (
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
      ) : null}
    </Stack>
  )
}
