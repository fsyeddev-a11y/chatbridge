import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AppManifest,
  AppRegistryEntry,
  AuditEvent,
  BridgeSessionRecord,
  ClassAppAllowlist,
  ReviewAction,
  SessionBridgeState,
} from './types.js'
import { getAllowedOriginsForLaunchUrl, getConfiguredWeatherAppUrl, type BridgeStore } from './store.js'

type SupabaseBridgeStoreRow = {
  app_id: string
  review_state: AppRegistryEntry['reviewState']
  registered_at: number
  reviewed_at: number | null
  review_notes: string | null
  owner_user_id: string | null
  owner_email: string | null
  manifest: AppManifest
}

type SupabaseAllowlistRow = {
  id: string
  class_id: string
  app_id: string
  enabled_by: string
  enabled_at: number
  disabled_at: number | null
}

type SupabaseReviewActionRow = {
  id: string
  app_id: string
  version: string
  action: ReviewAction['action']
  reviewer_id: string
  notes: string | null
  timestamp: number
}

type SupabaseAuditEventRow = {
  id: string
  timestamp: number
  trace_id: string
  event_type: string
  source: AuditEvent['source']
  session_id: string | null
  class_id: string | null
  student_id: string | null
  app_id: string | null
  app_version: string | null
  summary: string | null
  metadata: Record<string, unknown> | null
}

type SupabaseBridgeSessionRow = {
  id: string
  session_id: string
  user_id: string
  bridge_state: SessionBridgeState
  updated_at: number
}

type SupabaseAppContextSnapshotRow = {
  id: string
  session_id: string
  user_id: string
  app_id: string
  status: 'idle' | 'ready' | 'active' | 'error' | 'complete'
  summary: string | null
  last_state: Record<string, unknown> | null
  last_error: string | null
  captured_at: number
}

export function getSupabasePersistenceConfig() {
  return {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

export function isSupabasePersistenceEnabled() {
  const { url, serviceRoleKey } = getSupabasePersistenceConfig()
  return Boolean(url && serviceRoleKey)
}

export function createSupabaseBridgeStore(client = createSupabaseBridgeStoreClient()): BridgeStore {
  let seedPromise: Promise<void> | null = null

  async function ensureSeeded() {
    if (!seedPromise) {
      seedPromise = bootstrapSeedData(client)
    }

    await seedPromise
  }

  return {
    async listRegistryEntries() {
      await ensureSeeded()
      const rows = await readRegistryRows(client)
      return rows.map(mapRegistryRow)
    },

    async listRegistryEntriesForOwner(userId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('apps')
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
        .eq('owner_user_id', userId)
        .order('registered_at', { ascending: false })
        .returns<SupabaseBridgeStoreRow[]>()

      if (error) {
        throw error
      }

      return (data || []).map(mapRegistryRow)
    },

    async getRegistryEntry(appId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('apps')
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
        .eq('app_id', appId)
        .maybeSingle<SupabaseBridgeStoreRow>()

      if (error) {
        throw error
      }

      return data ? mapRegistryRow(data) : undefined
    },

    async listApprovedAppsForClass(classId) {
      await ensureSeeded()
      const { data: allowlistRows, error: allowlistError } = await client
        .from('class_allowlists')
        .select('id, class_id, app_id, enabled_by, enabled_at, disabled_at')
        .eq('class_id', classId)
        .is('disabled_at', null)
        .returns<SupabaseAllowlistRow[]>()

      if (allowlistError) {
        throw allowlistError
      }

      const enabledAppIds = (allowlistRows || []).map((row) => row.app_id)
      if (!enabledAppIds.length) {
        return []
      }

      const { data: appRows, error: appError } = await client
        .from('apps')
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
        .in('app_id', enabledAppIds)
        .eq('review_state', 'approved')
        .returns<SupabaseBridgeStoreRow[]>()

      if (appError) {
        throw appError
      }

      return (appRows || []).map(mapRegistryRow)
    },

    async listClassAllowlist(classId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('class_allowlists')
        .select('id, class_id, app_id, enabled_by, enabled_at, disabled_at')
        .eq('class_id', classId)
        .order('enabled_at', { ascending: true })
        .returns<SupabaseAllowlistRow[]>()

      if (error) {
        throw error
      }

      return (data || []).map(mapAllowlistRow)
    },

    async registerApp(manifest, owner) {
      await ensureSeeded()
      const existing = await this.getRegistryEntry(manifest.appId)
      const now = Date.now()

      const row: SupabaseBridgeStoreRow = {
        app_id: manifest.appId,
        review_state: 'pending',
        registered_at: existing?.registeredAt ?? now,
        reviewed_at: null,
        review_notes: null,
        owner_user_id: owner?.userId ?? existing?.ownerUserId ?? null,
        owner_email: owner?.email ?? existing?.ownerEmail ?? null,
        manifest: migrateManifest(manifest),
      }

      const { data, error } = await client
        .from('apps')
        .upsert(row, { onConflict: 'app_id' })
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
        .single<SupabaseBridgeStoreRow>()

      if (error) {
        throw error
      }

      return mapRegistryRow(data)
    },

    async updateReviewState(appId, reviewState, reviewerId, reviewNotes) {
      await ensureSeeded()
      const existing = await this.getRegistryEntry(appId)
      if (!existing) {
        return undefined
      }

      const reviewedAt = Date.now()
      const { data, error } = await client
        .from('apps')
        .update({
          review_state: reviewState,
          reviewed_at: reviewedAt,
          review_notes: reviewNotes ?? null,
        })
        .eq('app_id', appId)
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
        .single<SupabaseBridgeStoreRow>()

      if (error) {
        throw error
      }

      const actionRow: SupabaseReviewActionRow = {
        id: randomUUID(),
        app_id: appId,
        version: existing.manifest.version,
        action: mapReviewStateToAction(reviewState),
        reviewer_id: reviewerId,
        notes: reviewNotes ?? null,
        timestamp: reviewedAt,
      }

      const { error: actionError } = await client.from('review_actions').insert(actionRow)
      if (actionError) {
        throw actionError
      }

      return mapRegistryRow(data)
    },

    async enableAppForClass(classId, appId, enabledBy) {
      await ensureSeeded()
      const appEntry = await this.getRegistryEntry(appId)
      if (!appEntry || appEntry.reviewState !== 'approved') {
        return undefined
      }

      const row: SupabaseAllowlistRow = {
        id: `${classId}:${appId}`,
        class_id: classId,
        app_id: appId,
        enabled_by: enabledBy,
        enabled_at: Date.now(),
        disabled_at: null,
      }

      const { data, error } = await client
        .from('class_allowlists')
        .upsert(row, { onConflict: 'id' })
        .select('id, class_id, app_id, enabled_by, enabled_at, disabled_at')
        .single<SupabaseAllowlistRow>()

      if (error) {
        throw error
      }

      return mapAllowlistRow(data)
    },

    async disableAppForClass(classId, appId, _enabledBy) {
      await ensureSeeded()
      const existingRows = await this.listClassAllowlist(classId)
      const existing = existingRows.find((entry) => entry.appId === appId && !entry.disabledAt)
      if (!existing) {
        return undefined
      }

      const { data, error } = await client
        .from('class_allowlists')
        .update({
          disabled_at: Date.now(),
        })
        .eq('id', `${classId}:${appId}`)
        .select('id, class_id, app_id, enabled_by, enabled_at, disabled_at')
        .single<SupabaseAllowlistRow>()

      if (error) {
        throw error
      }

      return mapAllowlistRow(data)
    },

    async appendAuditEvent(event) {
      await ensureSeeded()
      const row: SupabaseAuditEventRow = {
        id: randomUUID(),
        timestamp: event.timestamp,
        trace_id: event.traceId,
        event_type: event.eventType,
        source: event.source,
        session_id: event.sessionId ?? null,
        class_id: event.classId ?? null,
        student_id: event.studentId ?? null,
        app_id: event.appId ?? null,
        app_version: event.appVersion ?? null,
        summary: event.summary ?? null,
        metadata: event.metadata ?? null,
      }

      const { data, error } = await client
        .from('audit_events')
        .insert(row)
        .select(
          'id, timestamp, trace_id, event_type, source, session_id, class_id, student_id, app_id, app_version, summary, metadata'
        )
        .single<SupabaseAuditEventRow>()

      if (error) {
        throw error
      }

      return mapAuditEventRow(data)
    },

    async listAuditEvents() {
      await ensureSeeded()
      const { data, error } = await client
        .from('audit_events')
        .select(
          'id, timestamp, trace_id, event_type, source, session_id, class_id, student_id, app_id, app_version, summary, metadata'
        )
        .order('timestamp', { ascending: true })
        .returns<SupabaseAuditEventRow[]>()

      if (error) {
        throw error
      }

      return (data || []).map(mapAuditEventRow)
    },

    async listReviewActions() {
      await ensureSeeded()
      const { data, error } = await client
        .from('review_actions')
        .select('id, app_id, version, action, reviewer_id, notes, timestamp')
        .order('timestamp', { ascending: true })
        .returns<SupabaseReviewActionRow[]>()

      if (error) {
        throw error
      }

      return (data || []).map(mapReviewActionRow)
    },

    async getBridgeSessionState(sessionId, userId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('bridge_sessions')
        .select('id, session_id, user_id, bridge_state, updated_at')
        .eq('id', `${sessionId}:${userId}`)
        .maybeSingle<SupabaseBridgeSessionRow>()

      if (error) {
        throw error
      }

      return data?.bridge_state
    },

    async upsertBridgeSessionState(sessionId, userId, bridgeState) {
      await ensureSeeded()
      const updatedAt = Date.now()
      const row: SupabaseBridgeSessionRow = {
        id: `${sessionId}:${userId}`,
        session_id: sessionId,
        user_id: userId,
        bridge_state: bridgeState,
        updated_at: updatedAt,
      }

      const { data, error } = await client
        .from('bridge_sessions')
        .upsert(row, { onConflict: 'id' })
        .select('id, session_id, user_id, bridge_state, updated_at')
        .single<SupabaseBridgeSessionRow>()

      if (error) {
        throw error
      }

      const snapshotRows = buildAppContextSnapshotRows(sessionId, userId, bridgeState, updatedAt)
      if (snapshotRows.length) {
        const { error: snapshotError } = await client.from('app_context_snapshots').insert(snapshotRows)
        if (snapshotError) {
          throw snapshotError
        }
      }

      return mapBridgeSessionRow(data)
    },
  }
}

async function bootstrapSeedData(client: SupabaseClient) {
  const seedData = createSupabaseSeedData()

  const missingRegistryEntries = await getMissingSeedRegistryEntries(client, seedData.registryEntries)
  if (missingRegistryEntries.length) {
    const { error: seedAppsError } = await client.from('apps').upsert(
      missingRegistryEntries.map((entry) => ({
        app_id: entry.manifest.appId,
        review_state: entry.reviewState,
        registered_at: entry.registeredAt,
        reviewed_at: entry.reviewedAt ?? null,
        review_notes: entry.reviewNotes ?? null,
        owner_user_id: entry.ownerUserId ?? null,
        owner_email: entry.ownerEmail ?? null,
        manifest: entry.manifest,
      })),
      { onConflict: 'app_id' }
    )

    if (seedAppsError) {
      throw seedAppsError
    }
  }

  const missingAllowlistEntries = await getMissingSeedAllowlistEntries(client, seedData.classAllowlist)
  if (missingAllowlistEntries.length) {
    const { error: seedAllowlistError } = await client.from('class_allowlists').upsert(
      missingAllowlistEntries.map((entry) => ({
        id: `${entry.classId}:${entry.appId}`,
        class_id: entry.classId,
        app_id: entry.appId,
        enabled_by: entry.enabledBy,
        enabled_at: entry.enabledAt,
        disabled_at: entry.disabledAt ?? null,
      })),
      { onConflict: 'id' }
    )

    if (seedAllowlistError) {
      throw seedAllowlistError
    }
  }
}

export async function getMissingSeedRegistryEntries(
  client: SupabaseClient,
  seedEntries: AppRegistryEntry[]
) {
  const seedAppIds = seedEntries.map((entry) => entry.manifest.appId)
  if (!seedAppIds.length) {
    return []
  }

  const { data: existingRows, error } = await client
    .from('apps')
    .select('app_id')
    .in('app_id', seedAppIds)
    .returns<Array<Pick<SupabaseBridgeStoreRow, 'app_id'>>>()

  if (error) {
    throw error
  }

  const existingAppIds = new Set((existingRows || []).map((row) => row.app_id))
  return seedEntries.filter((entry) => !existingAppIds.has(entry.manifest.appId))
}

export async function getMissingSeedAllowlistEntries(
  client: SupabaseClient,
  seedEntries: ClassAppAllowlist[]
) {
  const seedIds = seedEntries.map((entry) => `${entry.classId}:${entry.appId}`)
  if (!seedIds.length) {
    return []
  }

  const { data: existingRows, error } = await client
    .from('class_allowlists')
    .select('id')
    .in('id', seedIds)
    .returns<Array<Pick<SupabaseAllowlistRow, 'id'>>>()

  if (error) {
    throw error
  }

  const existingIds = new Set((existingRows || []).map((row) => row.id))
  return seedEntries.filter((entry) => !existingIds.has(`${entry.classId}:${entry.appId}`))
}

function createSupabaseBridgeStoreClient() {
  const { url, serviceRoleKey } = getSupabasePersistenceConfig()

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase persistence is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function readRegistryRows(client: SupabaseClient) {
  const { data, error } = await client
    .from('apps')
    .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
    .order('registered_at', { ascending: true })
    .returns<SupabaseBridgeStoreRow[]>()

  if (error) {
    throw error
  }

  return data || []
}

function mapRegistryRow(row: SupabaseBridgeStoreRow): AppRegistryEntry {
  return {
    manifest: migrateManifest(row.manifest),
    reviewState: row.review_state,
    registeredAt: row.registered_at,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewNotes: row.review_notes ?? undefined,
    ownerUserId: row.owner_user_id ?? undefined,
    ownerEmail: row.owner_email ?? undefined,
  }
}

function mapAllowlistRow(row: SupabaseAllowlistRow): ClassAppAllowlist {
  return {
    classId: row.class_id,
    appId: row.app_id,
    enabledBy: row.enabled_by,
    enabledAt: row.enabled_at,
    disabledAt: row.disabled_at ?? undefined,
  }
}

function mapReviewActionRow(row: SupabaseReviewActionRow): ReviewAction {
  return {
    appId: row.app_id,
    version: row.version,
    action: row.action,
    reviewerId: row.reviewer_id,
    notes: row.notes ?? undefined,
    timestamp: row.timestamp,
  }
}

function mapAuditEventRow(row: SupabaseAuditEventRow): AuditEvent {
  return {
    timestamp: row.timestamp,
    traceId: row.trace_id,
    eventType: row.event_type,
    source: row.source,
    sessionId: row.session_id ?? undefined,
    classId: row.class_id ?? undefined,
    studentId: row.student_id ?? undefined,
    appId: row.app_id ?? undefined,
    appVersion: row.app_version ?? undefined,
    summary: row.summary ?? undefined,
    metadata: row.metadata ?? undefined,
  }
}

function mapBridgeSessionRow(row: SupabaseBridgeSessionRow): BridgeSessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    bridgeState: row.bridge_state,
    updatedAt: row.updated_at,
  }
}

export function buildAppContextSnapshotRows(
  sessionId: string,
  userId: string,
  bridgeState: SessionBridgeState,
  capturedAt: number
): SupabaseAppContextSnapshotRow[] {
  return Object.values(bridgeState.appContext).map((context) => ({
    id: `${sessionId}:${userId}:${context.appId}:${capturedAt}`,
    session_id: sessionId,
    user_id: userId,
    app_id: context.appId,
    status: context.status,
    summary: context.summary ?? null,
    last_state: context.lastState ?? null,
    last_error: context.lastError ?? null,
    captured_at: capturedAt,
  }))
}

function createSupabaseSeedData() {
  const now = Date.now()
  const weatherAppUrl = getConfiguredWeatherAppUrl()
  const weatherAllowedOrigins = getAllowedOriginsForLaunchUrl(weatherAppUrl)

  return {
    registryEntries: [
      {
        reviewState: 'approved' as const,
        registeredAt: now,
        reviewedAt: now,
        reviewNotes: undefined,
        manifest: {
          appId: 'chess',
          name: 'Chess Coach',
          version: '1.0.0',
          description: 'Interactive chess board with guided tutoring.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe' as const,
          allowedOrigins: ['https://apps.chatbridge.local'],
          authType: 'none' as const,
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
        reviewState: 'approved' as const,
        registeredAt: now,
        reviewedAt: now,
        reviewNotes: undefined,
        manifest: {
          appId: 'weather',
          name: 'Weather Dashboard',
          version: '1.0.0',
          description: 'Lightweight public weather app for quick lookups.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe' as const,
          launchUrl: weatherAppUrl,
          allowedOrigins: weatherAllowedOrigins,
          heartbeatTimeoutMs: 10000,
          authType: 'none' as const,
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
        reviewState: 'approved' as const,
        registeredAt: now,
        reviewedAt: now,
        reviewNotes: undefined,
        manifest: {
          appId: 'google-classroom',
          name: 'Google Classroom Assistant',
          version: '1.0.0',
          description: 'Read-only classroom context for due dates and coursework.',
          developerName: 'ChatBridge Demo',
          executionModel: 'iframe' as const,
          allowedOrigins: ['https://apps.chatbridge.local'],
          authType: 'oauth2' as const,
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
    ],
    classAllowlist: [
      { classId: 'demo-class', appId: 'chess', enabledBy: 'teacher-demo', enabledAt: now, disabledAt: undefined },
      { classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: now, disabledAt: undefined },
      {
        classId: 'demo-class',
        appId: 'google-classroom',
        enabledBy: 'teacher-demo',
        enabledAt: now,
        disabledAt: undefined,
      },
    ],
  }
}

function migrateManifest(manifest: AppManifest): AppManifest {
  if (manifest.appId !== 'weather') {
    return manifest
  }

  const launchUrl = manifest.launchUrl || getConfiguredWeatherAppUrl()

  return {
    ...manifest,
    launchUrl,
    allowedOrigins:
      manifest.allowedOrigins?.length && !manifest.allowedOrigins.includes('https://apps.chatbridge.local')
        ? manifest.allowedOrigins
        : getAllowedOriginsForLaunchUrl(launchUrl),
    heartbeatTimeoutMs: manifest.heartbeatTimeoutMs || 10000,
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
