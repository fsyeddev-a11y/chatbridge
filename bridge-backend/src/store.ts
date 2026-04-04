import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  AppManifest,
  AppRegistryEntry,
  AppVersionRecord,
  AuditEvent,
  BridgeSessionRecord,
  ClassAppAllowlist,
  ReviewAction,
  SessionBridgeState,
} from './types.js'
import { createSupabaseBridgeStore } from './supabase-store.js'

type Awaitable<T> = T | Promise<T>

export type BridgeStore = {
  listRegistryEntries(): Awaitable<AppRegistryEntry[]>
  listRegistryEntriesForOwner(userId: string): Awaitable<AppRegistryEntry[]>
  getRegistryEntry(appId: string): Awaitable<AppRegistryEntry | undefined>
  listApprovedAppsForClass(classId: string): Awaitable<AppRegistryEntry[]>
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
  enableAppForClass(classId: string, appId: string, enabledBy: string): Awaitable<ClassAppAllowlist | undefined>
  disableAppForClass(classId: string, appId: string, enabledBy: string): Awaitable<ClassAppAllowlist | undefined>
  appendAuditEvent(event: AuditEvent): Awaitable<AuditEvent>
  listAuditEvents(): Awaitable<AuditEvent[]>
  listReviewActions(): Awaitable<ReviewAction[]>
  listReviewActionsForOwner(userId: string): Awaitable<ReviewAction[]>
  getBridgeSessionState(sessionId: string, userId: string): Awaitable<SessionBridgeState | undefined>
  upsertBridgeSessionState(sessionId: string, userId: string, bridgeState: SessionBridgeState): Awaitable<BridgeSessionRecord>
}

export type BridgeStoreData = {
  registryEntries: AppRegistryEntry[]
  appVersions: AppVersionRecord[]
  classAllowlist: ClassAppAllowlist[]
  auditEvents: AuditEvent[]
  reviewActions: ReviewAction[]
  bridgeSessions: BridgeSessionRecord[]
}

export type BridgeStoreDriver = 'file' | 'supabase'

const DEFAULT_WEATHER_APP_URL = 'http://localhost:4173'

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
      allowedOrigins: ['https://apps.chatbridge.local'],
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
      allowedOrigins: ['https://apps.chatbridge.local'],
      authType: 'oauth2',
      subjectTags: ['Productivity', 'Classroom'],
      gradeBand: '3-12',
      llmSafeFields: ['courseCount', 'upcomingAssignments'],
      tools: [
        {
          name: 'chatbridge_google_classroom_overview',
          description: 'Retrieve a read-only summary of the student classroom workload.',
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
    registryEntries,
    appVersions,
    classAllowlist: [
      { classId: 'demo-class', appId: 'chess', enabledBy: 'teacher-demo', enabledAt: now },
      { classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: now },
      { classId: 'demo-class', appId: 'google-classroom', enabledBy: 'teacher-demo', enabledAt: now },
    ],
    auditEvents: [],
    reviewActions: [],
    bridgeSessions: [],
  }
}

function createBridgeStoreFromData(data: BridgeStoreData, onWrite?: (nextData: BridgeStoreData) => void): BridgeStore {
  const { registryEntries, appVersions, classAllowlist, auditEvents, reviewActions, bridgeSessions } = data

  function persist() {
    onWrite?.({
      registryEntries,
      appVersions,
      classAllowlist,
      auditEvents,
      reviewActions,
      bridgeSessions,
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

  return {
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
      const enabledAppIds = new Set(
        classAllowlist.filter((entry) => entry.classId === classId && !entry.disabledAt).map((entry) => entry.appId)
      )
      return registryEntries
        .filter((entry) => entry.activeManifest && enabledAppIds.has(entry.manifest.appId))
        .map((entry) => ({
          ...entry,
          manifest: entry.activeManifest || entry.manifest,
          reviewState: 'approved',
        }))
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
    enableAppForClass(classId, appId, enabledBy) {
      const existingRegistryEntry = registryEntries.find((entry) => entry.manifest.appId === appId)
      if (!existingRegistryEntry?.activeManifest) {
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
    registryEntries: parsed.registryEntries || [],
    appVersions: parsed.appVersions || [],
    classAllowlist: parsed.classAllowlist || [],
    auditEvents: parsed.auditEvents || [],
    reviewActions: parsed.reviewActions || [],
    bridgeSessions: parsed.bridgeSessions || [],
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
    registryEntries: migratedRegistryEntries,
    appVersions: migratedVersions,
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
