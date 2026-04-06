import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  AppManifest,
  AppRegistryEntry,
  AppVersionRecord,
  AuditEvent,
  ClassMembershipRecord,
  ClassRecord,
  ChatSessionMetaRecord,
  ChatSessionRecord,
  BridgeSessionRecord,
  ClassAppAllowlist,
  OAuthTokenRecord,
  ReviewAction,
  SchoolAppAllowlist,
  SchoolMembershipRecord,
  SchoolRecord,
  SessionBridgeState,
  UserProfile,
  UserRoleAssignment,
} from './types.js'
import { createSupabaseBridgeStore } from './supabase-store.js'
import {
  normalizeRoles,
  resolveDefaultSchoolMembershipRoles,
  resolveDefaultUserRoles,
  selectPrimaryUserRole,
} from './authorization.js'

type Awaitable<T> = T | Promise<T>

export type BridgeStore = {
  getOrCreateUserProfile(user: {
    userId: string
    email?: string
  }): Awaitable<UserProfile>
  getUserProfile(userId: string): Awaitable<UserProfile | undefined>
  listSchoolsForUser(userId: string): Awaitable<SchoolRecord[]>
  listSchoolMembershipsForUser(userId: string): Awaitable<SchoolMembershipRecord[]>
  listClassesForUser(userId: string): Awaitable<ClassRecord[]>
  listClassMembershipsForUser(userId: string): Awaitable<ClassMembershipRecord[]>
  getClassRecord(classId: string): Awaitable<ClassRecord | undefined>
  listRegistryEntries(): Awaitable<AppRegistryEntry[]>
  listRegistryEntriesForOwner(userId: string): Awaitable<AppRegistryEntry[]>
  getRegistryEntry(appId: string): Awaitable<AppRegistryEntry | undefined>
  listApprovedAppsForClass(classId: string): Awaitable<AppRegistryEntry[]>
  listSchoolAllowlist(schoolId: string): Awaitable<SchoolAppAllowlist[]>
  listClassAllowlist(classId: string): Awaitable<ClassAppAllowlist[]>
  registerApp(
    manifest: AppManifest,
    owner?: {
      userId: string
      email?: string
    }
  ): Awaitable<AppRegistryEntry>
  updateReviewState(
    appId: string,
    reviewState: AppRegistryEntry['reviewState'],
    reviewerId: string,
    reviewNotes?: string,
    version?: string
  ): Awaitable<AppRegistryEntry | undefined>
  enableAppForSchool(schoolId: string, appId: string, enabledBy: string): Awaitable<SchoolAppAllowlist | undefined>
  disableAppForSchool(schoolId: string, appId: string, enabledBy: string): Awaitable<SchoolAppAllowlist | undefined>
  enableAppForClass(classId: string, appId: string, enabledBy: string): Awaitable<ClassAppAllowlist | undefined>
  disableAppForClass(classId: string, appId: string, enabledBy: string): Awaitable<ClassAppAllowlist | undefined>
  appendAuditEvent(event: AuditEvent): Awaitable<AuditEvent>
  listAuditEvents(): Awaitable<AuditEvent[]>
  listReviewActions(): Awaitable<ReviewAction[]>
  listReviewActionsForOwner(userId: string): Awaitable<ReviewAction[]>
  getBridgeSessionState(sessionId: string, userId: string): Awaitable<SessionBridgeState | undefined>
  upsertBridgeSessionState(sessionId: string, userId: string, bridgeState: SessionBridgeState): Awaitable<BridgeSessionRecord>
  getOAuthToken(userId: string, appId: string, provider: OAuthTokenRecord['provider']): Awaitable<OAuthTokenRecord | undefined>
  upsertOAuthToken(record: OAuthTokenRecord): Awaitable<OAuthTokenRecord>
  deleteOAuthToken(userId: string, appId: string, provider: OAuthTokenRecord['provider']): Awaitable<boolean>
  listChatSessions(userId: string): Awaitable<ChatSessionMetaRecord[]>
  getChatSession(sessionId: string, userId: string): Awaitable<ChatSessionRecord | undefined>
  upsertChatSession(
    session: Record<string, unknown>,
    user: {
      userId: string
      email?: string
    },
    previousSessionId?: string
  ): Awaitable<ChatSessionRecord>
  reorderChatSessions(userId: string, sessionIds: string[]): Awaitable<ChatSessionMetaRecord[]>
  deleteChatSession(sessionId: string, userId: string): Awaitable<boolean>
}

export type BridgeStoreData = {
  userProfiles: UserProfile[]
  userRoleAssignments: UserRoleAssignment[]
  schoolRecords: SchoolRecord[]
  schoolMemberships: SchoolMembershipRecord[]
  classRecords: ClassRecord[]
  classMemberships: ClassMembershipRecord[]
  registryEntries: AppRegistryEntry[]
  appVersions: AppVersionRecord[]
  schoolAllowlist: SchoolAppAllowlist[]
  classAllowlist: ClassAppAllowlist[]
  auditEvents: AuditEvent[]
  reviewActions: ReviewAction[]
  bridgeSessions: BridgeSessionRecord[]
  oauthTokens: OAuthTokenRecord[]
  chatSessions: ChatSessionRecord[]
}

export type BridgeStoreDriver = 'file' | 'supabase'

const DEFAULT_WEATHER_APP_URL = 'http://localhost:4173'
const DEFAULT_CHESS_APP_URL = 'http://localhost:4174'
const DEFAULT_TRIVIA_APP_URL = 'http://localhost:4175'
const DEFAULT_CLASSROOM_APP_URL = 'http://localhost:4176'
const DEMO_SCHOOL_ID = 'demo-school'
const DEMO_CLASS_ID = 'demo-class'

export function getConfiguredWeatherAppUrl(envValue = process.env.CHATBRIDGE_WEATHER_APP_URL) {
  if (!envValue) {
    return DEFAULT_WEATHER_APP_URL
  }

  try {
    return new URL(envValue).toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_WEATHER_APP_URL
  }
}

export function getConfiguredChessAppUrl(envValue = process.env.CHATBRIDGE_CHESS_APP_URL) {
  if (!envValue) {
    return DEFAULT_CHESS_APP_URL
  }

  try {
    return new URL(envValue).toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_CHESS_APP_URL
  }
}

export function getConfiguredTriviaAppUrl(envValue = process.env.CHATBRIDGE_TRIVIA_APP_URL) {
  if (!envValue) {
    return DEFAULT_TRIVIA_APP_URL
  }

  try {
    return new URL(envValue).toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_TRIVIA_APP_URL
  }
}

export function getConfiguredClassroomAppUrl(envValue = process.env.CHATBRIDGE_CLASSROOM_APP_URL) {
  if (!envValue) {
    return DEFAULT_CLASSROOM_APP_URL
  }

  try {
    return new URL(envValue).toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_CLASSROOM_APP_URL
  }
}

export function getAllowedOriginsForLaunchUrl(launchUrl: string) {
  try {
    return [new URL(launchUrl).origin]
  } catch {
    return [new URL(DEFAULT_WEATHER_APP_URL).origin]
  }
}

function buildRegistryEntryFromVersions(input: {
  appId: string
  ownerUserId?: string
  ownerEmail?: string
  registeredAt: number
  preferredActiveVersion?: string
  versions: AppVersionRecord[]
}) {
  const sortedVersions = [...input.versions].sort((left, right) => right.submittedAt - left.submittedAt)
  const pendingVersion =
    sortedVersions.find((version) => version.reviewState === 'pending') ||
    sortedVersions.find((version) => version.reviewState === 'rejected') ||
    sortedVersions.find((version) => version.reviewState === 'suspended')
  const activeVersion =
    (input.preferredActiveVersion
      ? sortedVersions.find((version) => version.version === input.preferredActiveVersion && version.reviewState === 'approved')
      : undefined) || sortedVersions.find((version) => version.reviewState === 'approved')

  const displayVersion = pendingVersion || activeVersion
  if (!displayVersion) {
    return undefined
  }

  return {
    manifest: displayVersion.manifest,
    reviewState: displayVersion.reviewState,
    registeredAt: input.registeredAt,
    reviewedAt: displayVersion.reviewedAt,
    reviewNotes: displayVersion.reviewNotes,
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail,
    activeManifest: activeVersion?.manifest,
    activeVersion: activeVersion?.version,
    pendingManifest: pendingVersion?.manifest,
    pendingVersion: pendingVersion?.version,
  } satisfies AppRegistryEntry
}

function createSeedData(): BridgeStoreData {
  const now = Date.now()
  const weatherAppUrl = getConfiguredWeatherAppUrl()
  const weatherAllowedOrigins = getAllowedOriginsForLaunchUrl(weatherAppUrl)

  const seededManifests: AppManifest[] = [
    {
      appId: 'chess',
      name: 'Chess Coach',
      version: '1.0.0',
      description: 'Interactive chess board with guided tutoring.',
      developerName: 'ChatBridge Demo',
      executionModel: 'iframe',
      launchUrl: getConfiguredChessAppUrl(),
      allowedOrigins: getAllowedOriginsForLaunchUrl(getConfiguredChessAppUrl()),
      authType: 'none',
      subjectTags: ['Strategy', 'Logic'],
      gradeBand: '3-12',
      llmSafeFields: ['phase', 'fen'],
      tools: [
        {
          name: 'chatbridge_chess_start_game',
          description: 'Start a new chess game for the current student.',
        },
        {
          name: 'chatbridge_chess_get_hint',
          description: 'Get a tutoring hint for the current board position.',
        },
      ],
    },
    {
      appId: 'weather',
      name: 'Weather Dashboard',
      version: '1.0.0',
      description: 'Lightweight public weather app for quick lookups.',
      developerName: 'ChatBridge Demo',
      executionModel: 'iframe',
      launchUrl: weatherAppUrl,
      allowedOrigins: weatherAllowedOrigins,
      heartbeatTimeoutMs: 10000,
      authType: 'none',
      subjectTags: ['Science'],
      gradeBand: 'K-12',
      llmSafeFields: ['location', 'conditions', 'temperatureF'],
      tools: [
        {
          name: 'chatbridge_weather_lookup',
          description: 'Look up current weather for a student-selected location.',
        },
      ],
    },
    {
      appId: 'google-classroom',
      name: 'Google Classroom Assistant',
      version: '1.0.0',
      description: 'Read-only classroom context for due dates and coursework.',
      developerName: 'ChatBridge Demo',
      executionModel: 'iframe',
      launchUrl: getConfiguredClassroomAppUrl(),
      allowedOrigins: getAllowedOriginsForLaunchUrl(getConfiguredClassroomAppUrl()),
      authType: 'oauth2',
      oauthProvider: 'google',
      oauthScopes: [
        'https://www.googleapis.com/auth/classroom.courses.readonly',
        'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      ],
      subjectTags: ['Productivity', 'Classroom'],
      gradeBand: '3-12',
      llmSafeFields: ['courseCount', 'upcomingAssignments'],
      tools: [
        {
          name: 'chatbridge_google_classroom_overview',
          description: 'Open Google Classroom so the student can connect their account and view courses and assignments.',
        },
      ],
    },
    {
      appId: 'trivia',
      name: 'Science Trivia',
      version: '1.0.0',
      description: 'Multiple-choice science trivia quiz with adjustable difficulty.',
      developerName: 'ChatBridge Demo',
      executionModel: 'iframe',
      launchUrl: getConfiguredTriviaAppUrl(),
      allowedOrigins: getAllowedOriginsForLaunchUrl(getConfiguredTriviaAppUrl()),
      heartbeatTimeoutMs: 10000,
      authType: 'none',
      subjectTags: ['Science', 'General Knowledge'],
      gradeBand: 'K-12',
      llmSafeFields: ['score', 'totalAnswered', 'totalQuestions', 'category', 'difficulty'],
      tools: [
        {
          name: 'chatbridge_trivia_start_quiz',
          description: 'Start a science trivia quiz for the student.',
        },
      ],
    },
  ]

  const appVersions: AppVersionRecord[] = seededManifests.map((manifest) => ({
    appId: manifest.appId,
    version: manifest.version,
    manifest,
    reviewState: 'approved',
    submittedAt: now,
    reviewedAt: now,
    ownerUserId: 'system-demo',
    ownerEmail: 'demo@chatbridge.local',
  }))

  const registryEntries: AppRegistryEntry[] = seededManifests.map((manifest) => ({
    manifest,
    reviewState: 'approved',
    registeredAt: now,
    reviewedAt: now,
    ownerUserId: 'system-demo',
    ownerEmail: 'demo@chatbridge.local',
    activeManifest: manifest,
    activeVersion: manifest.version,
  }))

  return {
    userProfiles: [],
    userRoleAssignments: [],
    schoolRecords: [
      {
        schoolId: DEMO_SCHOOL_ID,
        name: 'Demo School',
        createdAt: now,
        updatedAt: now,
      },
    ],
    schoolMemberships: [],
    classRecords: [
      {
        classId: DEMO_CLASS_ID,
        schoolId: DEMO_SCHOOL_ID,
        name: 'Demo Class',
        createdAt: now,
        updatedAt: now,
      },
    ],
    classMemberships: [],
    registryEntries,
    appVersions,
    schoolAllowlist: [
      { schoolId: DEMO_SCHOOL_ID, appId: 'chess', enabledBy: 'school-admin-demo', enabledAt: now },
      { schoolId: DEMO_SCHOOL_ID, appId: 'weather', enabledBy: 'school-admin-demo', enabledAt: now },
      { schoolId: DEMO_SCHOOL_ID, appId: 'google-classroom', enabledBy: 'school-admin-demo', enabledAt: now },
      { schoolId: DEMO_SCHOOL_ID, appId: 'trivia', enabledBy: 'school-admin-demo', enabledAt: now },
    ],
    classAllowlist: [
      { classId: DEMO_CLASS_ID, appId: 'chess', enabledBy: 'teacher-demo', enabledAt: now },
      { classId: DEMO_CLASS_ID, appId: 'weather', enabledBy: 'teacher-demo', enabledAt: now },
      { classId: DEMO_CLASS_ID, appId: 'google-classroom', enabledBy: 'teacher-demo', enabledAt: now },
      { classId: DEMO_CLASS_ID, appId: 'trivia', enabledBy: 'teacher-demo', enabledAt: now },
    ],
    auditEvents: [],
    reviewActions: [],
    bridgeSessions: [],
    oauthTokens: [],
    chatSessions: [],
  }
}

function createBridgeStoreFromData(data: BridgeStoreData, onWrite?: (nextData: BridgeStoreData) => void): BridgeStore {
  const {
    userProfiles,
    userRoleAssignments,
    schoolRecords,
    schoolMemberships,
    classRecords,
    classMemberships,
    registryEntries,
    appVersions,
    schoolAllowlist,
    classAllowlist,
    auditEvents,
    reviewActions,
    bridgeSessions,
    oauthTokens,
    chatSessions,
  } = data

  function persist() {
    onWrite?.({
      userProfiles,
      userRoleAssignments,
      schoolRecords,
      schoolMemberships,
      classRecords,
      classMemberships,
      registryEntries,
      appVersions,
      schoolAllowlist,
      classAllowlist,
      auditEvents,
      reviewActions,
      bridgeSessions,
      oauthTokens,
      chatSessions,
    })
  }

  function getVersionsForApp(appId: string) {
    return appVersions.filter((version) => version.appId === appId)
  }

  function rebuildRegistryEntry(appId: string) {
    const existing = registryEntries.find((entry) => entry.manifest.appId === appId)
    const rebuilt = buildRegistryEntryFromVersions({
      appId,
      ownerUserId: existing?.ownerUserId,
      ownerEmail: existing?.ownerEmail,
      registeredAt: existing?.registeredAt ?? Date.now(),
      preferredActiveVersion: existing?.activeVersion,
      versions: getVersionsForApp(appId),
    })

    const existingIndex = registryEntries.findIndex((entry) => entry.manifest.appId === appId)
    if (!rebuilt) {
      if (existingIndex >= 0) {
        registryEntries.splice(existingIndex, 1)
      }
      return undefined
    }

    if (existingIndex >= 0) {
      registryEntries[existingIndex] = rebuilt
    } else {
      registryEntries.push(rebuilt)
    }

    return rebuilt
  }

  function getUserProfileInternal(userId: string) {
    return userProfiles.find((profile) => profile.userId === userId)
  }

  function getActiveUserRoles(userId: string) {
    const assignedRoles = userRoleAssignments
      .filter((assignment) => assignment.userId === userId && !assignment.revokedAt)
      .map((assignment) => assignment.role)

    if (assignedRoles.length > 0) {
      return normalizeRoles(assignedRoles)
    }

    const existingProfile = getUserProfileInternal(userId)
    if (!existingProfile) {
      return []
    }

    return normalizeRoles(existingProfile.roles?.length ? existingProfile.roles : [existingProfile.role])
  }

  function ensureDefaultRoleAssignments(userId: string, email?: string) {
    const now = Date.now()
    const defaultRoles = resolveDefaultUserRoles(email)
    const desiredRoleSet = new Set(defaultRoles)
    let changed = false

    for (const assignment of userRoleAssignments.filter(
      (entry) => entry.userId === userId && !entry.revokedAt && entry.assignedBy === 'system-bootstrap'
    )) {
      if (!desiredRoleSet.has(assignment.role)) {
        assignment.revokedAt = now
        changed = true
      }
    }

    for (const role of defaultRoles) {
      const existing = userRoleAssignments.find(
        (assignment) => assignment.userId === userId && assignment.role === role && !assignment.revokedAt
      )
      if (!existing) {
        userRoleAssignments.push({
          userId,
          role,
          assignedBy: 'system-bootstrap',
          assignedAt: now,
        })
        changed = true
      }
    }

    return {
      roles: getActiveUserRoles(userId),
      changed,
    }
  }

  function ensureDemoSchoolExists() {
    const existing = schoolRecords.find((record) => record.schoolId === DEMO_SCHOOL_ID)
    if (existing) {
      return existing
    }

    const now = Date.now()
    const nextRecord: SchoolRecord = {
      schoolId: DEMO_SCHOOL_ID,
      name: 'Demo School',
      createdAt: now,
      updatedAt: now,
    }
    schoolRecords.push(nextRecord)
    return nextRecord
  }

  function ensureDemoClassExists() {
    const existing = classRecords.find((record) => record.classId === DEMO_CLASS_ID)
    if (existing) {
      return existing
    }

    const now = Date.now()
    ensureDemoSchoolExists()
    const nextRecord: ClassRecord = {
      classId: DEMO_CLASS_ID,
      schoolId: DEMO_SCHOOL_ID,
      name: 'Demo Class',
      createdAt: now,
      updatedAt: now,
    }
    classRecords.push(nextRecord)
    return nextRecord
  }

  function listActiveSchoolMembershipsForUser(userId: string) {
    return schoolMemberships.filter((membership) => membership.userId === userId && !membership.removedAt)
  }

  function listActiveClassMembershipsForUser(userId: string) {
    return classMemberships.filter((membership) => membership.userId === userId && !membership.removedAt)
  }

  function ensureDefaultSchoolMemberships(userId: string, email: string | undefined, roles: ReturnType<typeof getActiveUserRoles>) {
    const membershipRoles = resolveDefaultSchoolMembershipRoles(email, roles)
    const desiredRoles = new Set(membershipRoles)
    const existingMemberships = listActiveSchoolMembershipsForUser(userId)
    const demoMemberships = existingMemberships.filter((membership) => membership.schoolId === DEMO_SCHOOL_ID)
    ensureDemoSchoolExists()
    const now = Date.now()
    let changed = false

    for (const membership of demoMemberships) {
      if (!desiredRoles.has(membership.membershipRole)) {
        membership.removedAt = now
        changed = true
      }
    }

    const activeDemoRoles = new Set(
      listActiveSchoolMembershipsForUser(userId)
        .filter((membership) => membership.schoolId === DEMO_SCHOOL_ID)
        .map((membership) => membership.membershipRole)
    )

    for (const membershipRole of membershipRoles) {
      if (activeDemoRoles.has(membershipRole)) {
        continue
      }
      schoolMemberships.push({
        schoolId: DEMO_SCHOOL_ID,
        userId,
        membershipRole,
        createdAt: now,
      })
      changed = true
    }
    return changed
  }

  function ensureDefaultClassMembership(userId: string, schoolMembershipRoles: Array<'school_admin' | 'teacher' | 'student'>) {
    const membershipRole = schoolMembershipRoles.includes('teacher')
      ? 'teacher'
      : schoolMembershipRoles.includes('student')
        ? 'student'
        : undefined
    const existingMemberships = listActiveClassMembershipsForUser(userId)
    const demoMemberships = existingMemberships.filter((membership) => membership.classId === DEMO_CLASS_ID)
    const now = Date.now()
    let changed = false

    for (const membership of demoMemberships) {
      if (!membershipRole || membership.membershipRole !== membershipRole) {
        membership.removedAt = now
        changed = true
      }
    }

    if (!membershipRole) {
      return changed
    }

    if (
      listActiveClassMembershipsForUser(userId).some(
        (membership) => membership.classId === DEMO_CLASS_ID && membership.membershipRole === membershipRole
      )
    ) {
      return changed
    }

    ensureDemoClassExists()
    classMemberships.push({
      classId: DEMO_CLASS_ID,
      userId,
      membershipRole,
      createdAt: now,
    })
    return true
  }

  function buildChatSessionMeta(sessionRecord: ChatSessionRecord): ChatSessionMetaRecord {
    return {
      id: sessionRecord.id,
      userId: sessionRecord.userId,
      name: sessionRecord.name,
      type: sessionRecord.type,
      starred: sessionRecord.starred,
      hidden: sessionRecord.hidden,
      assistantAvatarKey: sessionRecord.assistantAvatarKey,
      picUrl: sessionRecord.picUrl,
      orderIndex: sessionRecord.orderIndex,
      createdAt: sessionRecord.createdAt,
      updatedAt: sessionRecord.updatedAt,
    }
  }

  function normalizeChatSessionRecord(session: Record<string, unknown>, userId: string, orderIndex: number, existing?: ChatSessionRecord) {
    const now = Date.now()
    const id = typeof session.id === 'string' ? session.id : existing?.id
    const name = typeof session.name === 'string' && session.name.trim() ? session.name : existing?.name || 'Untitled'
    if (!id) {
      throw new Error('Chat session id is required')
    }

    return {
      id,
      userId,
      name,
      type: session.type === 'chat' || session.type === 'picture' ? session.type : existing?.type,
      starred: typeof session.starred === 'boolean' ? session.starred : existing?.starred,
      hidden: typeof session.hidden === 'boolean' ? session.hidden : existing?.hidden,
      assistantAvatarKey:
        typeof session.assistantAvatarKey === 'string' ? session.assistantAvatarKey : existing?.assistantAvatarKey,
      picUrl: typeof session.picUrl === 'string' ? session.picUrl : existing?.picUrl,
      orderIndex,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      session,
    } satisfies ChatSessionRecord
  }

  function listChatSessionRecords(userId: string) {
    return chatSessions
      .filter((session) => session.userId === userId)
      .sort((left, right) => left.orderIndex - right.orderIndex || left.createdAt - right.createdAt)
  }

  function getChatSessionRecord(sessionId: string, userId: string) {
    return chatSessions.find((session) => session.id === sessionId && session.userId === userId)
  }

  return {
    getOrCreateUserProfile(user) {
      const existing = getUserProfileInternal(user.userId)
      const now = Date.now()
      if (existing) {
        const { roles, changed: rolesChanged } = ensureDefaultRoleAssignments(user.userId, user.email ?? existing.email)
        const nextPrimaryRole = selectPrimaryUserRole(roles)
        let changed = rolesChanged
        if (user.email && existing.email !== user.email) {
          existing.email = user.email
          changed = true
        }
        if (existing.role !== nextPrimaryRole) {
          existing.role = nextPrimaryRole
          changed = true
        }
        if (JSON.stringify(existing.roles) !== JSON.stringify(roles)) {
          existing.roles = roles
          changed = true
        }
        const schoolMembershipChanged = ensureDefaultSchoolMemberships(user.userId, user.email ?? existing.email, roles)
        if (schoolMembershipChanged) {
          changed = true
        }
        const schoolMembershipRoles = listActiveSchoolMembershipsForUser(user.userId).map((membership) => membership.membershipRole)
        if (ensureDefaultClassMembership(user.userId, schoolMembershipRoles)) {
          changed = true
        }
        if (changed) {
          existing.updatedAt = now
          persist()
        }
        return existing
      }

      const { roles } = ensureDefaultRoleAssignments(user.userId, user.email)
      ensureDemoSchoolExists()
      ensureDefaultSchoolMemberships(user.userId, user.email, roles)
      ensureDemoClassExists()
      ensureDefaultClassMembership(
        user.userId,
        listActiveSchoolMembershipsForUser(user.userId).map((membership) => membership.membershipRole)
      )
      const nextProfile: UserProfile = {
        userId: user.userId,
        email: user.email,
        role: selectPrimaryUserRole(roles),
        roles,
        createdAt: now,
        updatedAt: now,
      }
      userProfiles.push(nextProfile)
      persist()
      return nextProfile
    },
    getUserProfile(userId) {
      return getUserProfileInternal(userId)
    },
    listSchoolsForUser(userId) {
      const roles = getUserProfileInternal(userId)?.roles || []
      if (roles.includes('admin')) {
        return schoolRecords
      }

      const schoolIds = new Set(listActiveSchoolMembershipsForUser(userId).map((membership) => membership.schoolId))
      return schoolRecords.filter((record) => schoolIds.has(record.schoolId))
    },
    listSchoolMembershipsForUser(userId) {
      return listActiveSchoolMembershipsForUser(userId)
    },
    listClassesForUser(userId) {
      const roles = getUserProfileInternal(userId)?.roles || []
      if (roles.includes('admin')) {
        return classRecords
      }

      const classIds = new Set(listActiveClassMembershipsForUser(userId).map((membership) => membership.classId))
      const schoolAdminSchoolIds = new Set(
        listActiveSchoolMembershipsForUser(userId)
          .filter((membership) => membership.membershipRole === 'school_admin')
          .map((membership) => membership.schoolId)
      )

      if (schoolAdminSchoolIds.size > 0) {
        classRecords
          .filter((record) => record.schoolId && schoolAdminSchoolIds.has(record.schoolId))
          .forEach((record) => classIds.add(record.classId))
      }

      return classRecords.filter((record) => classIds.has(record.classId))
    },
    listClassMembershipsForUser(userId) {
      return listActiveClassMembershipsForUser(userId)
    },
    getClassRecord(classId) {
      return classRecords.find((record) => record.classId === classId)
    },
    listRegistryEntries() {
      return registryEntries
    },
    listRegistryEntriesForOwner(userId) {
      return registryEntries.filter((entry) => entry.ownerUserId === userId)
    },
    getRegistryEntry(appId) {
      return registryEntries.find((entry) => entry.manifest.appId === appId)
    },
    listApprovedAppsForClass(classId) {
      const classRecord = classRecords.find((record) => record.classId === classId)
      if (!classRecord?.schoolId) {
        return []
      }

      const schoolEnabledAppIds = new Set(
        schoolAllowlist
          .filter((entry) => entry.schoolId === classRecord.schoolId && !entry.disabledAt)
          .map((entry) => entry.appId)
      )
      const enabledAppIds = new Set(
        classAllowlist.filter((entry) => entry.classId === classId && !entry.disabledAt).map((entry) => entry.appId)
      )
      return registryEntries
        .filter(
          (entry) =>
            entry.activeManifest &&
            schoolEnabledAppIds.has(entry.manifest.appId) &&
            enabledAppIds.has(entry.manifest.appId)
        )
        .map((entry) => ({
          ...entry,
          manifest: entry.activeManifest || entry.manifest,
          reviewState: 'approved',
        }))
    },
    listSchoolAllowlist(schoolId) {
      return schoolAllowlist.filter((entry) => entry.schoolId === schoolId)
    },
    listClassAllowlist(classId) {
      return classAllowlist.filter((entry) => entry.classId === classId)
    },
    registerApp(manifest, owner) {
      const now = Date.now()
      const existing = registryEntries.find((entry) => entry.manifest.appId === manifest.appId)
      const existingVersion = appVersions.find((version) => version.appId === manifest.appId && version.version === manifest.version)
      const nextVersion: AppVersionRecord = {
        appId: manifest.appId,
        version: manifest.version,
        manifest,
        reviewState: 'pending',
        submittedAt: now,
        ownerUserId: owner?.userId ?? existing?.ownerUserId,
        ownerEmail: owner?.email ?? existing?.ownerEmail,
      }

      if (existingVersion) {
        const versionIndex = appVersions.indexOf(existingVersion)
        appVersions[versionIndex] = nextVersion
      } else {
        appVersions.push(nextVersion)
      }

      if (!existing) {
        registryEntries.push({
          manifest,
          reviewState: 'pending',
          registeredAt: now,
          ownerUserId: owner?.userId,
          ownerEmail: owner?.email,
          pendingManifest: manifest,
          pendingVersion: manifest.version,
        })
      } else {
        existing.ownerUserId = owner?.userId ?? existing.ownerUserId
        existing.ownerEmail = owner?.email ?? existing.ownerEmail
      }

      const rebuilt = rebuildRegistryEntry(manifest.appId)
      persist()
      return rebuilt!
    },
    updateReviewState(appId, reviewState, reviewerId, reviewNotes, version) {
      const existing = registryEntries.find((entry) => entry.manifest.appId === appId)
      if (!existing) {
        return undefined
      }

      const candidateVersions = getVersionsForApp(appId).sort((left, right) => right.submittedAt - left.submittedAt)
      const targetVersionRecord =
        (version ? candidateVersions.find((candidate) => candidate.version === version) : undefined) ||
        candidateVersions.find((candidate) => candidate.version === existing.pendingVersion) ||
        candidateVersions.find((candidate) => candidate.version === existing.manifest.version)

      if (!targetVersionRecord) {
        return undefined
      }

      const reviewedAt = Date.now()
      targetVersionRecord.reviewState = reviewState
      targetVersionRecord.reviewedAt = reviewedAt
      targetVersionRecord.reviewNotes = reviewNotes

      if (reviewState === 'approved') {
        existing.activeVersion = targetVersionRecord.version
      } else if (existing.activeVersion === targetVersionRecord.version) {
        const fallbackActiveVersion = candidateVersions.find(
          (candidate) => candidate.version !== targetVersionRecord.version && candidate.reviewState === 'approved'
        )
        existing.activeVersion = fallbackActiveVersion?.version
      }

      reviewActions.push({
        appId,
        version: targetVersionRecord.version,
        action: mapReviewStateToAction(reviewState),
        reviewerId,
        notes: reviewNotes,
        timestamp: reviewedAt,
      })

      const rebuilt = rebuildRegistryEntry(appId)
      persist()
      return rebuilt
    },
    enableAppForSchool(schoolId, appId, enabledBy) {
      const existingRegistryEntry = registryEntries.find((entry) => entry.manifest.appId === appId)
      if (!existingRegistryEntry?.activeManifest) {
        return undefined
      }

      const now = Date.now()
      const existing = schoolAllowlist.find((entry) => entry.schoolId === schoolId && entry.appId === appId)
      if (existing) {
        existing.disabledAt = undefined
        existing.enabledAt = now
        existing.enabledBy = enabledBy
        persist()
        return existing
      }

      const allowlistEntry: SchoolAppAllowlist = {
        schoolId,
        appId,
        enabledBy,
        enabledAt: now,
      }
      schoolAllowlist.push(allowlistEntry)
      persist()
      return allowlistEntry
    },
    disableAppForSchool(schoolId, appId, _enabledBy) {
      const existing = schoolAllowlist.find((entry) => entry.schoolId === schoolId && entry.appId === appId && !entry.disabledAt)
      if (!existing) {
        return undefined
      }

      existing.disabledAt = Date.now()
      persist()
      return existing
    },
    enableAppForClass(classId, appId, enabledBy) {
      const existingRegistryEntry = registryEntries.find((entry) => entry.manifest.appId === appId)
      const classRecord = classRecords.find((record) => record.classId === classId)
      if (!existingRegistryEntry?.activeManifest || !classRecord?.schoolId) {
        return undefined
      }

      const schoolEnabled = schoolAllowlist.find(
        (entry) => entry.schoolId === classRecord.schoolId && entry.appId === appId && !entry.disabledAt
      )
      if (!schoolEnabled) {
        return undefined
      }

      const now = Date.now()
      const existing = classAllowlist.find((entry) => entry.classId === classId && entry.appId === appId)
      if (existing) {
        existing.disabledAt = undefined
        existing.enabledAt = now
        existing.enabledBy = enabledBy
        persist()
        return existing
      }

      const allowlistEntry: ClassAppAllowlist = {
        classId,
        appId,
        enabledBy,
        enabledAt: now,
      }
      classAllowlist.push(allowlistEntry)
      persist()
      return allowlistEntry
    },
    disableAppForClass(classId, appId, _enabledBy) {
      const existing = classAllowlist.find((entry) => entry.classId === classId && entry.appId === appId && !entry.disabledAt)
      if (!existing) {
        return undefined
      }

      existing.disabledAt = Date.now()
      persist()
      return existing
    },
    appendAuditEvent(event) {
      auditEvents.push(event)
      persist()
      return event
    },
    listAuditEvents() {
      return auditEvents
    },
    listReviewActions() {
      return reviewActions
    },
    listReviewActionsForOwner(userId) {
      const ownedAppIds = new Set(
        registryEntries.filter((entry) => entry.ownerUserId === userId).map((entry) => entry.manifest.appId)
      )
      return reviewActions.filter((action) => ownedAppIds.has(action.appId))
    },
    getBridgeSessionState(sessionId, userId) {
      return bridgeSessions.find((entry) => entry.sessionId === sessionId && entry.userId === userId)?.bridgeState
    },
    upsertBridgeSessionState(sessionId, userId, bridgeState) {
      const now = Date.now()
      const existing = bridgeSessions.find((entry) => entry.sessionId === sessionId && entry.userId === userId)
      if (existing) {
        existing.bridgeState = bridgeState
        existing.updatedAt = now
        persist()
        return existing
      }

      const nextRecord: BridgeSessionRecord = {
        sessionId,
        userId,
        bridgeState,
        updatedAt: now,
      }
      bridgeSessions.push(nextRecord)
      persist()
      return nextRecord
    },
    getOAuthToken(userId, appId, provider) {
      return oauthTokens.find((record) => record.userId === userId && record.appId === appId && record.provider === provider)
    },
    upsertOAuthToken(record) {
      const existingIndex = oauthTokens.findIndex(
        (entry) => entry.userId === record.userId && entry.appId === record.appId && entry.provider === record.provider
      )
      if (existingIndex >= 0) {
        oauthTokens[existingIndex] = record
      } else {
        oauthTokens.push(record)
      }
      persist()
      return record
    },
    deleteOAuthToken(userId, appId, provider) {
      const existingIndex = oauthTokens.findIndex(
        (entry) => entry.userId === userId && entry.appId === appId && entry.provider === provider
      )
      if (existingIndex === -1) {
        return false
      }
      oauthTokens.splice(existingIndex, 1)
      persist()
      return true
    },
    listChatSessions(userId) {
      return listChatSessionRecords(userId).map(buildChatSessionMeta)
    },
    getChatSession(sessionId, userId) {
      return getChatSessionRecord(sessionId, userId)
    },
    upsertChatSession(session, user, previousSessionId) {
      this.getOrCreateUserProfile(user)
      const existing = getChatSessionRecord(String(session.id || ''), user.userId)
      let orderIndex = existing?.orderIndex

      if (orderIndex === undefined) {
        const userSessions = listChatSessionRecords(user.userId)
        if (previousSessionId) {
          const previous = userSessions.find((entry) => entry.id === previousSessionId)
          if (previous) {
            orderIndex = previous.orderIndex + 1
            for (const candidate of userSessions) {
              if (candidate.orderIndex >= orderIndex) {
                candidate.orderIndex += 1
              }
            }
          }
        }

        if (orderIndex === undefined) {
          const maxOrderIndex = userSessions.reduce((max, candidate) => Math.max(max, candidate.orderIndex), -1)
          orderIndex = maxOrderIndex + 1
        }
      }

      const nextRecord = normalizeChatSessionRecord(session, user.userId, orderIndex, existing)
      if (existing) {
        const existingIndex = chatSessions.indexOf(existing)
        chatSessions[existingIndex] = nextRecord
      } else {
        chatSessions.push(nextRecord)
      }

      persist()
      return nextRecord
    },
    reorderChatSessions(userId, sessionIds) {
      const userSessions = listChatSessionRecords(userId)
      const knownIds = new Set(userSessions.map((session) => session.id))
      const nextOrderIds = [...sessionIds.filter((id) => knownIds.has(id)), ...userSessions.map((session) => session.id).filter((id) => !sessionIds.includes(id))]
      nextOrderIds.forEach((sessionId, index) => {
        const session = userSessions.find((entry) => entry.id === sessionId)
        if (session) {
          session.orderIndex = index
          session.updatedAt = Date.now()
        }
      })
      persist()
      return listChatSessionRecords(userId).map(buildChatSessionMeta)
    },
    deleteChatSession(sessionId, userId) {
      const existingIndex = chatSessions.findIndex((session) => session.id === sessionId && session.userId === userId)
      if (existingIndex === -1) {
        return false
      }
      chatSessions.splice(existingIndex, 1)
      persist()
      return true
    },
  }
}

export function createInMemoryBridgeStore(): BridgeStore {
  return createBridgeStoreFromData(createSeedData())
}

export function getConfiguredStoreDriver(envValue = process.env.CHATBRIDGE_STORE_DRIVER): BridgeStoreDriver {
  return envValue === 'supabase' ? 'supabase' : 'file'
}

export function getDefaultStoreFilePath() {
  return path.resolve(process.cwd(), 'data', 'bridge-store.json')
}

export function createFileBackedBridgeStore(filePath = getDefaultStoreFilePath()): BridgeStore {
  const directory = path.dirname(filePath)
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }

  const initialData = existsSync(filePath) ? readStoreFile(filePath) : writeSeedFile(filePath)

  return createBridgeStoreFromData(initialData, (nextData) => {
    writeFileSync(filePath, `${JSON.stringify(nextData, null, 2)}\n`, 'utf8')
  })
}

export function createConfiguredBridgeStore(filePath = process.env.CHATBRIDGE_STORE_PATH || getDefaultStoreFilePath()): BridgeStore {
  const driver = getConfiguredStoreDriver()

  if (driver === 'supabase') {
    return createSupabaseBridgeStore()
  }

  return createFileBackedBridgeStore(filePath)
}

function readStoreFile(filePath: string): BridgeStoreData {
  const raw = readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<BridgeStoreData>

  return migrateStoreData({
    userProfiles: parsed.userProfiles || [],
    userRoleAssignments: parsed.userRoleAssignments || [],
    schoolRecords: parsed.schoolRecords || [],
    schoolMemberships: parsed.schoolMemberships || [],
    classRecords: parsed.classRecords || [],
    classMemberships: parsed.classMemberships || [],
    registryEntries: parsed.registryEntries || [],
    appVersions: parsed.appVersions || [],
    schoolAllowlist: parsed.schoolAllowlist || [],
    classAllowlist: parsed.classAllowlist || [],
    auditEvents: parsed.auditEvents || [],
    reviewActions: parsed.reviewActions || [],
    bridgeSessions: parsed.bridgeSessions || [],
    oauthTokens: parsed.oauthTokens || [],
    chatSessions: parsed.chatSessions || [],
  })
}

function writeSeedFile(filePath: string): BridgeStoreData {
  const seedData = migrateStoreData(createSeedData())
  writeFileSync(filePath, `${JSON.stringify(seedData, null, 2)}\n`, 'utf8')
  return seedData
}

function migrateStoreData(data: BridgeStoreData): BridgeStoreData {
  const weatherAppUrl = getConfiguredWeatherAppUrl()
  const weatherAllowedOrigins = getAllowedOriginsForLaunchUrl(weatherAppUrl)

  const migratedRegistryEntries = data.registryEntries.map((entry) => {
    const manifest =
      entry.manifest.appId === 'weather'
        ? {
            ...entry.manifest,
            launchUrl: entry.manifest.launchUrl || weatherAppUrl,
            allowedOrigins:
              entry.manifest.allowedOrigins?.length && !entry.manifest.allowedOrigins.includes('https://apps.chatbridge.local')
                ? entry.manifest.allowedOrigins
                : weatherAllowedOrigins,
            heartbeatTimeoutMs: entry.manifest.heartbeatTimeoutMs || 10000,
          }
        : entry.manifest

    return {
      ...entry,
      manifest,
      activeManifest: entry.activeManifest
        ? entry.activeManifest.appId === 'weather'
          ? {
              ...entry.activeManifest,
              launchUrl: entry.activeManifest.launchUrl || weatherAppUrl,
              allowedOrigins:
                entry.activeManifest.allowedOrigins?.length &&
                !entry.activeManifest.allowedOrigins.includes('https://apps.chatbridge.local')
                  ? entry.activeManifest.allowedOrigins
                  : weatherAllowedOrigins,
              heartbeatTimeoutMs: entry.activeManifest.heartbeatTimeoutMs || 10000,
            }
          : entry.activeManifest
        : undefined,
    }
  })

  const migratedVersions =
    data.appVersions.length > 0
      ? data.appVersions.map((version) => ({
          ...version,
          manifest:
            version.manifest.appId === 'weather'
              ? {
                  ...version.manifest,
                  launchUrl: version.manifest.launchUrl || weatherAppUrl,
                  allowedOrigins:
                    version.manifest.allowedOrigins?.length &&
                    !version.manifest.allowedOrigins.includes('https://apps.chatbridge.local')
                      ? version.manifest.allowedOrigins
                      : weatherAllowedOrigins,
                  heartbeatTimeoutMs: version.manifest.heartbeatTimeoutMs || 10000,
                }
              : version.manifest,
        }))
      : migratedRegistryEntries.map((entry) => ({
          appId: entry.manifest.appId,
          version: entry.activeVersion || entry.manifest.version,
          manifest: entry.activeManifest || entry.manifest,
          reviewState: entry.activeManifest ? 'approved' : entry.reviewState,
          submittedAt: entry.registeredAt,
          reviewedAt: entry.reviewedAt,
          reviewNotes: entry.reviewNotes,
          ownerUserId: entry.ownerUserId,
          ownerEmail: entry.ownerEmail,
        }))

  return {
    ...data,
    userProfiles: (data.userProfiles || []).map((profile) => ({
      ...profile,
      role: selectPrimaryUserRole(profile.roles?.length ? profile.roles : [profile.role]),
      roles: normalizeRoles(profile.roles?.length ? profile.roles : [profile.role]),
    })),
    userRoleAssignments:
      data.userRoleAssignments?.length
        ? data.userRoleAssignments
        : (data.userProfiles || []).flatMap((profile) =>
            normalizeRoles(profile.roles?.length ? profile.roles : [profile.role]).map((role) => ({
              userId: profile.userId,
              role,
              assignedBy: 'legacy-migration',
              assignedAt: profile.createdAt,
            }))
          ),
    schoolRecords:
      data.schoolRecords?.length
        ? data.schoolRecords
        : [
            {
              schoolId: DEMO_SCHOOL_ID,
              name: 'Demo School',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
    schoolMemberships: data.schoolMemberships || [],
    classRecords:
      data.classRecords?.length
        ? data.classRecords.map((record) => ({
            ...record,
            schoolId: record.schoolId || DEMO_SCHOOL_ID,
          }))
        : [
            {
              classId: DEMO_CLASS_ID,
              schoolId: DEMO_SCHOOL_ID,
              name: 'Demo Class',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
    classMemberships: data.classMemberships || [],
    registryEntries: migratedRegistryEntries,
    appVersions: migratedVersions,
    schoolAllowlist:
      data.schoolAllowlist?.length
        ? data.schoolAllowlist
        : [
            { schoolId: DEMO_SCHOOL_ID, appId: 'chess', enabledBy: 'school-admin-demo', enabledAt: Date.now() },
            { schoolId: DEMO_SCHOOL_ID, appId: 'weather', enabledBy: 'school-admin-demo', enabledAt: Date.now() },
            {
              schoolId: DEMO_SCHOOL_ID,
              appId: 'google-classroom',
              enabledBy: 'school-admin-demo',
              enabledAt: Date.now(),
            },
          ],
    chatSessions: data.chatSessions || [],
  }
}

function mapReviewStateToAction(reviewState: AppRegistryEntry['reviewState']): ReviewAction['action'] {
  switch (reviewState) {
    case 'approved':
      return 'approve'
    case 'rejected':
      return 'reject'
    case 'suspended':
      return 'suspend'
    case 'pending':
      return 'request_changes'
  }
}
