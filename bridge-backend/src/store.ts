import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AppManifest, AppRegistryEntry, AuditEvent, ClassAppAllowlist, ReviewAction } from './types.js'

export type BridgeStore = {
  listRegistryEntries(): AppRegistryEntry[]
  getRegistryEntry(appId: string): AppRegistryEntry | undefined
  listApprovedAppsForClass(classId: string): AppRegistryEntry[]
  listClassAllowlist(classId: string): ClassAppAllowlist[]
  registerApp(manifest: AppManifest): AppRegistryEntry
  updateReviewState(
    appId: string,
    reviewState: AppRegistryEntry['reviewState'],
    reviewerId: string,
    reviewNotes?: string
  ): AppRegistryEntry | undefined
  enableAppForClass(classId: string, appId: string, enabledBy: string): ClassAppAllowlist | undefined
  disableAppForClass(classId: string, appId: string, enabledBy: string): ClassAppAllowlist | undefined
  appendAuditEvent(event: AuditEvent): AuditEvent
  listAuditEvents(): AuditEvent[]
  listReviewActions(): ReviewAction[]
}

export type BridgeStoreData = {
  registryEntries: AppRegistryEntry[]
  classAllowlist: ClassAppAllowlist[]
  auditEvents: AuditEvent[]
  reviewActions: ReviewAction[]
}

function createSeedData(): BridgeStoreData {
  const now = Date.now()

  const registryEntries: AppRegistryEntry[] = [
    {
      reviewState: 'approved',
      registeredAt: now,
      reviewedAt: now,
      manifest: {
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
    },
    {
      reviewState: 'approved',
      registeredAt: now,
      reviewedAt: now,
      manifest: {
        appId: 'weather',
        name: 'Weather Dashboard',
        version: '1.0.0',
        description: 'Lightweight public weather app for quick lookups.',
        developerName: 'ChatBridge Demo',
        executionModel: 'iframe',
        launchUrl: 'http://localhost:4173',
        allowedOrigins: ['http://localhost:4173'],
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
    },
    {
      reviewState: 'approved',
      registeredAt: now,
      reviewedAt: now,
      manifest: {
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
    },
  ]

  const classAllowlist: ClassAppAllowlist[] = [
    { classId: 'demo-class', appId: 'chess', enabledBy: 'teacher-demo', enabledAt: now },
    { classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: now },
    { classId: 'demo-class', appId: 'google-classroom', enabledBy: 'teacher-demo', enabledAt: now },
  ]

  const auditEvents: AuditEvent[] = []
  const reviewActions: ReviewAction[] = []

  return {
    registryEntries,
    classAllowlist,
    auditEvents,
    reviewActions,
  }
}

function createBridgeStoreFromData(data: BridgeStoreData, onWrite?: (nextData: BridgeStoreData) => void): BridgeStore {
  const { registryEntries, classAllowlist, auditEvents, reviewActions } = data

  function persist() {
    onWrite?.({
      registryEntries,
      classAllowlist,
      auditEvents,
      reviewActions,
    })
  }

  return {
    listRegistryEntries() {
      return registryEntries
    },
    getRegistryEntry(appId) {
      return registryEntries.find((entry) => entry.manifest.appId === appId)
    },
    listApprovedAppsForClass(classId) {
      const enabledAppIds = new Set(
        classAllowlist.filter((entry) => entry.classId === classId && !entry.disabledAt).map((entry) => entry.appId)
      )
      return registryEntries.filter(
        (entry) => entry.reviewState === 'approved' && enabledAppIds.has(entry.manifest.appId)
      )
    },
    listClassAllowlist(classId) {
      return classAllowlist.filter((entry) => entry.classId === classId)
    },
    registerApp(manifest) {
      const existing = registryEntries.find((entry) => entry.manifest.appId === manifest.appId)
      const now = Date.now()
      const nextEntry: AppRegistryEntry = {
        manifest,
        reviewState: existing?.reviewState === 'approved' ? 'pending' : 'pending',
        registeredAt: existing?.registeredAt ?? now,
      }

      if (existing) {
        const index = registryEntries.indexOf(existing)
        registryEntries[index] = nextEntry
      } else {
        registryEntries.push(nextEntry)
      }

      persist()
      return nextEntry
    },
    updateReviewState(appId, reviewState, reviewerId, reviewNotes) {
      const existing = registryEntries.find((entry) => entry.manifest.appId === appId)
      if (!existing) {
        return undefined
      }

      existing.reviewState = reviewState
      existing.reviewedAt = Date.now()
      existing.reviewNotes = reviewNotes
      reviewActions.push({
        appId,
        version: existing.manifest.version,
        action: mapReviewStateToAction(reviewState),
        reviewerId,
        notes: reviewNotes,
        timestamp: existing.reviewedAt,
      })
      persist()
      return existing
    },
    enableAppForClass(classId, appId, enabledBy) {
      const existingRegistryEntry = registryEntries.find((entry) => entry.manifest.appId === appId)
      if (!existingRegistryEntry || existingRegistryEntry.reviewState !== 'approved') {
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
  }
}

export function createInMemoryBridgeStore(): BridgeStore {
  return createBridgeStoreFromData(createSeedData())
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

function readStoreFile(filePath: string): BridgeStoreData {
  const raw = readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<BridgeStoreData>

  return migrateStoreData({
    registryEntries: parsed.registryEntries || [],
    classAllowlist: parsed.classAllowlist || [],
    auditEvents: parsed.auditEvents || [],
    reviewActions: parsed.reviewActions || [],
  })
}

function writeSeedFile(filePath: string): BridgeStoreData {
  const seedData = migrateStoreData(createSeedData())
  writeFileSync(filePath, `${JSON.stringify(seedData, null, 2)}\n`, 'utf8')
  return seedData
}

function migrateStoreData(data: BridgeStoreData): BridgeStoreData {
  return {
    ...data,
    registryEntries: data.registryEntries.map((entry) => {
      if (entry.manifest.appId !== 'weather') {
        return entry
      }

      return {
        ...entry,
        manifest: {
          ...entry.manifest,
          launchUrl: entry.manifest.launchUrl || 'http://localhost:4173',
          allowedOrigins:
            entry.manifest.allowedOrigins?.length && !entry.manifest.allowedOrigins.includes('https://apps.chatbridge.local')
              ? entry.manifest.allowedOrigins
              : ['http://localhost:4173'],
          heartbeatTimeoutMs: entry.manifest.heartbeatTimeoutMs || 10000,
        },
      }
    }),
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
