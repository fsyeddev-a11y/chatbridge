import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AppManifest,
  AppRegistryEntry,
  AppVersionRecord,
  AuditEvent,
  ChatSessionMetaRecord,
  ChatSessionRecord,
  BridgeSessionRecord,
  ClassAppAllowlist,
  OAuthTokenRecord,
  ReviewAction,
  SessionBridgeState,
  UserProfile,
} from './types.js'
import { getAllowedOriginsForLaunchUrl, getConfiguredWeatherAppUrl, resolveDefaultUserRole, type BridgeStore } from './store.js'

type SupabaseBridgeStoreRow = {
  app_id: string
  review_state: AppRegistryEntry['reviewState']
  registered_at: number
  reviewed_at: number | null
  review_notes: string | null
  owner_user_id: string | null
  owner_email: string | null
  active_version: string | null
  manifest: AppManifest
}

type SupabaseAppVersionRow = {
  id: string
  app_id: string
  version: string
  review_state: AppVersionRecord['reviewState']
  submitted_at: number
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

type SupabaseOAuthTokenRow = {
  id: string
  user_id: string
  app_id: string
  provider: OAuthTokenRecord['provider']
  access_token: string
  refresh_token: string | null
  expires_at: number | null
  scopes: string[]
  created_at: number
  last_refreshed_at: number | null
}

type SupabaseUserProfileRow = {
  user_id: string
  email: string | null
  role: 'admin' | 'teacher' | 'student' | 'developer'
  created_at: number
  updated_at: number
}

type SupabaseChatSessionRow = {
  id: string
  user_id: string
  name: string
  type: 'chat' | 'picture' | null
  starred: boolean | null
  hidden: boolean | null
  assistant_avatar_key: string | null
  pic_url: string | null
  order_index: number
  payload: Record<string, unknown>
  created_at: number
  updated_at: number
}

type RegistryComposition = {
  appRows: SupabaseBridgeStoreRow[]
  versionRows: SupabaseAppVersionRow[]
}

type SupabaseSeedData = {
  registryEntries: AppRegistryEntry[]
  appVersions: AppVersionRecord[]
  classAllowlist: ClassAppAllowlist[]
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
    async getOrCreateUserProfile(user) {
      await ensureSeeded()
      const existing = await this.getUserProfile(user.userId)
      const now = Date.now()
      if (existing) {
        if (user.email && existing.email !== user.email) {
          const { data, error } = await client
            .from('user_profiles')
            .update({
              email: user.email,
              updated_at: now,
            })
            .eq('user_id', user.userId)
            .select('user_id, email, role, created_at, updated_at')
            .single<SupabaseUserProfileRow>()

          if (error) {
            throw error
          }

          return mapUserProfileRow(data)
        }

        return existing
      }

      const row: SupabaseUserProfileRow = {
        user_id: user.userId,
        email: user.email ?? null,
        role: resolveDefaultUserRole(user.email),
        created_at: now,
        updated_at: now,
      }

      const { data, error } = await client
        .from('user_profiles')
        .upsert(row, { onConflict: 'user_id' })
        .select('user_id, email, role, created_at, updated_at')
        .single<SupabaseUserProfileRow>()

      if (error) {
        throw error
      }

      return mapUserProfileRow(data)
    },

    async getUserProfile(userId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('user_profiles')
        .select('user_id, email, role, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle<SupabaseUserProfileRow>()

      if (error) {
        throw error
      }

      return data ? mapUserProfileRow(data) : undefined
    },

    async listRegistryEntries() {
      await ensureSeeded()
      const { appRows, versionRows } = await readRegistryComposition(client)
      return composeRegistryEntries(appRows, versionRows)
    },

    async listRegistryEntriesForOwner(userId) {
      await ensureSeeded()
      const { data: appRows, error } = await client
        .from('apps')
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, active_version, manifest')
        .eq('owner_user_id', userId)
        .order('registered_at', { ascending: false })
        .returns<SupabaseBridgeStoreRow[]>()

      if (error) {
        throw error
      }

      const appIds = (appRows || []).map((row) => row.app_id)
      const versionRows = await readVersionRowsForAppIds(client, appIds)
      return composeRegistryEntries(appRows || [], versionRows)
    },

    async getRegistryEntry(appId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('apps')
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, active_version, manifest')
        .eq('app_id', appId)
        .maybeSingle<SupabaseBridgeStoreRow>()

      if (error) {
        throw error
      }

      if (!data) {
        return undefined
      }

      const versionRows = await readVersionRowsForAppIds(client, [appId])
      return composeRegistryEntries([data], versionRows)[0]
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
        .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, active_version, manifest')
        .in('app_id', enabledAppIds)
        .eq('review_state', 'approved')
        .returns<SupabaseBridgeStoreRow[]>()

      if (appError) {
        throw appError
      }

      const versionRows = await readVersionRowsForAppIds(client, enabledAppIds)
      return composeRegistryEntries(appRows || [], versionRows).map((entry) => ({
        ...entry,
        manifest: entry.activeManifest || entry.manifest,
        reviewState: 'approved',
      }))
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
      const migratedManifest = migrateManifest(manifest)
      const versionId = buildVersionRecordId(manifest.appId, manifest.version)

      const versionRow: SupabaseAppVersionRow = {
        id: versionId,
        app_id: manifest.appId,
        version: manifest.version,
        review_state: 'pending',
        submitted_at: now,
        reviewed_at: null,
        review_notes: null,
        owner_user_id: owner?.userId ?? existing?.ownerUserId ?? null,
        owner_email: owner?.email ?? existing?.ownerEmail ?? null,
        manifest: migratedManifest,
      }

      const { error: versionError } = await client.from('app_versions').upsert(versionRow, { onConflict: 'app_id,version' })
      if (versionError) {
        throw versionError
      }

      const currentActiveVersion = existing?.activeVersion ?? null
      const row: SupabaseBridgeStoreRow = {
        app_id: manifest.appId,
        review_state: 'pending',
        registered_at: existing?.registeredAt ?? now,
        reviewed_at: null,
        review_notes: null,
        owner_user_id: owner?.userId ?? existing?.ownerUserId ?? null,
        owner_email: owner?.email ?? existing?.ownerEmail ?? null,
        active_version: currentActiveVersion,
        manifest: migratedManifest,
      }

      const { error: appError } = await client.from('apps').upsert(row, { onConflict: 'app_id' })
      if (appError) {
        throw appError
      }

      return await this.getRegistryEntry(manifest.appId) as AppRegistryEntry
    },

    async updateReviewState(appId, reviewState, reviewerId, reviewNotes, version) {
      await ensureSeeded()
      const existing = await this.getRegistryEntry(appId)
      if (!existing) {
        return undefined
      }

      const versionRows = await readVersionRowsForAppIds(client, [appId])
      const sortedVersions = versionRows.sort((left, right) => right.submitted_at - left.submitted_at)
      const targetRow =
        (version ? sortedVersions.find((candidate) => candidate.version === version) : undefined) ||
        (existing.pendingVersion ? sortedVersions.find((candidate) => candidate.version === existing.pendingVersion) : undefined) ||
        sortedVersions.find((candidate) => candidate.version === existing.manifest.version)

      if (!targetRow) {
        return undefined
      }

      const reviewedAt = Date.now()
      const { error: versionUpdateError } = await client
        .from('app_versions')
        .update({
          review_state: reviewState,
          reviewed_at: reviewedAt,
          review_notes: reviewNotes ?? null,
        })
        .eq('id', targetRow.id)

      if (versionUpdateError) {
        throw versionUpdateError
      }

      const refreshedVersionRows = await readVersionRowsForAppIds(client, [appId])
      const nextAppRow = buildAppRowAfterReview(existing, refreshedVersionRows, targetRow.version, reviewState, reviewNotes, reviewedAt)

      const { error: appUpdateError } = await client
        .from('apps')
        .update({
          review_state: nextAppRow.review_state,
          reviewed_at: nextAppRow.reviewed_at,
          review_notes: nextAppRow.review_notes,
          manifest: nextAppRow.manifest,
          active_version: nextAppRow.active_version,
          owner_user_id: nextAppRow.owner_user_id,
          owner_email: nextAppRow.owner_email,
        })
        .eq('app_id', appId)

      if (appUpdateError) {
        throw appUpdateError
      }

      const actionRow: SupabaseReviewActionRow = {
        id: randomUUID(),
        app_id: appId,
        version: targetRow.version,
        action: mapReviewStateToAction(reviewState),
        reviewer_id: reviewerId,
        notes: reviewNotes ?? null,
        timestamp: reviewedAt,
      }

      const { error: actionError } = await client.from('review_actions').insert(actionRow)
      if (actionError) {
        throw actionError
      }

      return await this.getRegistryEntry(appId)
    },

    async enableAppForClass(classId, appId, enabledBy) {
      await ensureSeeded()
      const appEntry = await this.getRegistryEntry(appId)
      if (!appEntry || !appEntry.activeManifest) {
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

    async listReviewActionsForOwner(userId) {
      await ensureSeeded()
      const ownedApps = await this.listRegistryEntriesForOwner(userId)
      const ownedAppIds = ownedApps.map((entry) => entry.manifest.appId)
      if (!ownedAppIds.length) {
        return []
      }

      const { data, error } = await client
        .from('review_actions')
        .select('id, app_id, version, action, reviewer_id, notes, timestamp')
        .in('app_id', ownedAppIds)
        .order('timestamp', { ascending: false })
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
    async getOAuthToken(userId, appId, provider) {
      await ensureSeeded()
      const { data, error } = await client
        .from('oauth_tokens')
        .select('id, user_id, app_id, provider, access_token, refresh_token, expires_at, scopes, created_at, last_refreshed_at')
        .eq('id', buildOAuthTokenRowId(userId, appId, provider))
        .maybeSingle<SupabaseOAuthTokenRow>()

      if (error) {
        throw error
      }

      return data ? mapOAuthTokenRow(data) : undefined
    },
    async upsertOAuthToken(record) {
      await ensureSeeded()
      const row: SupabaseOAuthTokenRow = {
        id: buildOAuthTokenRowId(record.userId, record.appId, record.provider),
        user_id: record.userId,
        app_id: record.appId,
        provider: record.provider,
        access_token: record.accessToken,
        refresh_token: record.refreshToken ?? null,
        expires_at: record.expiresAt ?? null,
        scopes: record.scopes,
        created_at: record.createdAt,
        last_refreshed_at: record.lastRefreshedAt ?? null,
      }

      const { data, error } = await client
        .from('oauth_tokens')
        .upsert(row, { onConflict: 'user_id,app_id,provider' })
        .select('id, user_id, app_id, provider, access_token, refresh_token, expires_at, scopes, created_at, last_refreshed_at')
        .single<SupabaseOAuthTokenRow>()

      if (error) {
        throw error
      }

      return mapOAuthTokenRow(data)
    },
    async deleteOAuthToken(userId, appId, provider) {
      await ensureSeeded()
      const { error, count } = await client
        .from('oauth_tokens')
        .delete({ count: 'exact' })
        .eq('id', buildOAuthTokenRowId(userId, appId, provider))

      if (error) {
        throw error
      }

      return Boolean(count)
    },
    async listChatSessions(userId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('chat_sessions')
        .select('id, user_id, name, type, starred, hidden, assistant_avatar_key, pic_url, order_index, payload, created_at, updated_at')
        .eq('user_id', userId)
        .order('order_index', { ascending: true })
        .returns<SupabaseChatSessionRow[]>()

      if (error) {
        throw error
      }

      return (data || []).map(mapChatSessionMetaRow)
    },
    async getChatSession(sessionId, userId) {
      await ensureSeeded()
      const { data, error } = await client
        .from('chat_sessions')
        .select('id, user_id, name, type, starred, hidden, assistant_avatar_key, pic_url, order_index, payload, created_at, updated_at')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle<SupabaseChatSessionRow>()

      if (error) {
        throw error
      }

      return data ? mapChatSessionRow(data) : undefined
    },
    async upsertChatSession(session, user, previousSessionId) {
      await ensureSeeded()
      await this.getOrCreateUserProfile(user)
      const existing = await this.getChatSession(String(session.id || ''), user.userId)
      let orderIndex = existing?.orderIndex

      if (orderIndex === undefined) {
        const userSessions = await this.listChatSessions(user.userId)
        if (previousSessionId) {
          const previous = userSessions.find((entry) => entry.id === previousSessionId)
          if (previous) {
            const nextOrderIndex = previous.orderIndex + 1
            orderIndex = nextOrderIndex
            const sessionsToShift = userSessions.filter((entry) => entry.orderIndex >= nextOrderIndex)
            if (sessionsToShift.length) {
              const { error: shiftError } = await client
                .from('chat_sessions')
                .upsert(
                  sessionsToShift.map((entry) => ({
                    id: entry.id,
                    user_id: user.userId,
                    order_index: entry.orderIndex + 1,
                  })),
                  { onConflict: 'id' }
                )

              if (shiftError) {
                throw shiftError
              }
            }
          }
        }

        if (orderIndex === undefined) {
          orderIndex = userSessions.length ? Math.max(...userSessions.map((entry) => entry.orderIndex)) + 1 : 0
        }
      }

      const now = Date.now()
      const row: SupabaseChatSessionRow = {
        id: String(session.id),
        user_id: user.userId,
        name: typeof session.name === 'string' && session.name.trim() ? session.name : existing?.name || 'Untitled',
        type: session.type === 'chat' || session.type === 'picture' ? session.type : existing?.type || null,
        starred: typeof session.starred === 'boolean' ? session.starred : existing?.starred ?? null,
        hidden: typeof session.hidden === 'boolean' ? session.hidden : existing?.hidden ?? null,
        assistant_avatar_key:
          typeof session.assistantAvatarKey === 'string'
            ? session.assistantAvatarKey
            : existing?.assistantAvatarKey || null,
        pic_url: typeof session.picUrl === 'string' ? session.picUrl : existing?.picUrl || null,
        order_index: orderIndex,
        payload: session,
        created_at: existing?.createdAt ?? now,
        updated_at: now,
      }

      const { data, error } = await client
        .from('chat_sessions')
        .upsert(row, { onConflict: 'id' })
        .select('id, user_id, name, type, starred, hidden, assistant_avatar_key, pic_url, order_index, payload, created_at, updated_at')
        .single<SupabaseChatSessionRow>()

      if (error) {
        throw error
      }

      return mapChatSessionRow(data)
    },
    async reorderChatSessions(userId, sessionIds) {
      await ensureSeeded()
      const existing = await this.listChatSessions(userId)
      const existingIds = new Set(existing.map((entry) => entry.id))
      const orderedIds = [
        ...sessionIds.filter((id) => existingIds.has(id)),
        ...existing.map((entry) => entry.id).filter((id) => !sessionIds.includes(id)),
      ]

      if (!orderedIds.length) {
        return []
      }

      const { error } = await client.from('chat_sessions').upsert(
        orderedIds.map((sessionId, index) => ({
          id: sessionId,
          user_id: userId,
          order_index: index,
        })),
        { onConflict: 'id' }
      )

      if (error) {
        throw error
      }

      return await this.listChatSessions(userId)
    },
    async deleteChatSession(sessionId, userId) {
      await ensureSeeded()
      const { error, count } = await client
        .from('chat_sessions')
        .delete({ count: 'exact' })
        .eq('id', sessionId)
        .eq('user_id', userId)

      if (error) {
        throw error
      }

      return Boolean(count)
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
        active_version: entry.activeVersion ?? null,
        manifest: entry.manifest,
      })),
      { onConflict: 'app_id' }
    )

    if (seedAppsError) {
      throw seedAppsError
    }
  }

  const missingVersionEntries = await getMissingSeedVersionEntries(client, seedData.appVersions)
  if (missingVersionEntries.length) {
    const { error: seedVersionsError } = await client.from('app_versions').upsert(
      missingVersionEntries.map((entry) => ({
        id: buildVersionRecordId(entry.appId, entry.version),
        app_id: entry.appId,
        version: entry.version,
        review_state: entry.reviewState,
        submitted_at: entry.submittedAt,
        reviewed_at: entry.reviewedAt ?? null,
        review_notes: entry.reviewNotes ?? null,
        owner_user_id: entry.ownerUserId ?? null,
        owner_email: entry.ownerEmail ?? null,
        manifest: entry.manifest,
      })),
      { onConflict: 'app_id,version' }
    )

    if (seedVersionsError) {
      throw seedVersionsError
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

export async function getMissingSeedRegistryEntries(client: SupabaseClient, seedEntries: AppRegistryEntry[]) {
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

export async function getMissingSeedVersionEntries(client: SupabaseClient, seedEntries: AppVersionRecord[]) {
  const seedIds = seedEntries.map((entry) => buildVersionRecordId(entry.appId, entry.version))
  if (!seedIds.length) {
    return []
  }

  const { data: existingRows, error } = await client
    .from('app_versions')
    .select('id')
    .in('id', seedIds)
    .returns<Array<Pick<SupabaseAppVersionRow, 'id'>>>()

  if (error) {
    throw error
  }

  const existingIds = new Set((existingRows || []).map((row) => row.id))
  return seedEntries.filter((entry) => !existingIds.has(buildVersionRecordId(entry.appId, entry.version)))
}

export async function getMissingSeedAllowlistEntries(client: SupabaseClient, seedEntries: ClassAppAllowlist[]) {
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

async function readRegistryComposition(client: SupabaseClient): Promise<RegistryComposition> {
  const appRows = await readRegistryRows(client)
  const versionRows = await readVersionRowsForAppIds(client, appRows.map((row) => row.app_id))
  return { appRows, versionRows }
}

async function readRegistryRows(client: SupabaseClient) {
  const { data, error } = await client
    .from('apps')
    .select('app_id, review_state, registered_at, reviewed_at, review_notes, owner_user_id, owner_email, active_version, manifest')
    .order('registered_at', { ascending: true })
    .returns<SupabaseBridgeStoreRow[]>()

  if (error) {
    throw error
  }

  return data || []
}

async function readVersionRowsForAppIds(client: SupabaseClient, appIds: string[]) {
  if (!appIds.length) {
    return []
  }

  const { data, error } = await client
    .from('app_versions')
    .select('id, app_id, version, review_state, submitted_at, reviewed_at, review_notes, owner_user_id, owner_email, manifest')
    .in('app_id', appIds)
    .order('submitted_at', { ascending: false })
    .returns<SupabaseAppVersionRow[]>()

  if (error) {
    throw error
  }

  return data || []
}

function composeRegistryEntries(appRows: SupabaseBridgeStoreRow[], versionRows: SupabaseAppVersionRow[]) {
  const versionsByAppId = new Map<string, SupabaseAppVersionRow[]>()
  for (const versionRow of versionRows) {
    const current = versionsByAppId.get(versionRow.app_id) || []
    current.push(versionRow)
    versionsByAppId.set(versionRow.app_id, current)
  }

  return appRows
    .map((row) => buildRegistryEntryFromSupabaseRows(row, versionsByAppId.get(row.app_id) || []))
    .filter((entry): entry is AppRegistryEntry => Boolean(entry))
}

function buildRegistryEntryFromSupabaseRows(
  row: SupabaseBridgeStoreRow,
  versionRows: SupabaseAppVersionRow[]
): AppRegistryEntry | undefined {
  const sortedVersions = [...versionRows].sort((left, right) => right.submitted_at - left.submitted_at)
  const activeVersionRow =
    (row.active_version ? sortedVersions.find((version) => version.version === row.active_version) : undefined) ||
    sortedVersions.find((version) => version.review_state === 'approved')
  const pendingVersionRow = sortedVersions.find((version) => version.review_state === 'pending')
  const displayVersionRow =
    pendingVersionRow ||
    sortedVersions.find((version) => version.version === row.manifest.version) ||
    activeVersionRow ||
    sortedVersions[0]

  if (!displayVersionRow) {
    return undefined
  }

  return {
    manifest: migrateManifest(displayVersionRow.manifest),
    reviewState: displayVersionRow.review_state,
    registeredAt: row.registered_at,
    reviewedAt: displayVersionRow.reviewed_at ?? undefined,
    reviewNotes: displayVersionRow.review_notes ?? undefined,
    ownerUserId: row.owner_user_id ?? displayVersionRow.owner_user_id ?? undefined,
    ownerEmail: row.owner_email ?? displayVersionRow.owner_email ?? undefined,
    activeManifest: activeVersionRow ? migrateManifest(activeVersionRow.manifest) : undefined,
    activeVersion: activeVersionRow?.version,
    pendingManifest: pendingVersionRow ? migrateManifest(pendingVersionRow.manifest) : undefined,
    pendingVersion: pendingVersionRow?.version,
  }
}

function buildAppRowAfterReview(
  existing: AppRegistryEntry,
  versionRows: SupabaseAppVersionRow[],
  reviewedVersion: string,
  reviewState: AppRegistryEntry['reviewState'],
  reviewNotes: string | undefined,
  reviewedAt: number
): SupabaseBridgeStoreRow {
  const sortedVersions = [...versionRows].sort((left, right) => right.submitted_at - left.submitted_at)
  const targetVersionRow = sortedVersions.find((row) => row.version === reviewedVersion)
  const approvedVersions = sortedVersions.filter((row) => row.review_state === 'approved')
  const activeVersionRow =
    reviewState === 'approved'
      ? targetVersionRow
      : approvedVersions.find((row) => row.version === existing.activeVersion) || approvedVersions[0]

  const displayVersionRow =
    reviewState === 'approved'
      ? targetVersionRow
      : activeVersionRow ||
        sortedVersions.find((row) => row.version === reviewedVersion) ||
        sortedVersions.find((row) => row.review_state === 'pending') ||
        sortedVersions[0]

  if (!displayVersionRow) {
    throw new Error(`Unable to rebuild app row for ${existing.manifest.appId}`)
  }

  return {
    app_id: existing.manifest.appId,
    review_state: activeVersionRow ? 'approved' : displayVersionRow.review_state,
    registered_at: existing.registeredAt,
    reviewed_at: reviewState === 'approved' || !activeVersionRow ? reviewedAt : activeVersionRow.reviewed_at ?? reviewedAt,
    review_notes:
      reviewState === 'approved' || !activeVersionRow ? reviewNotes ?? null : activeVersionRow.review_notes ?? null,
    owner_user_id: existing.ownerUserId ?? targetVersionRow?.owner_user_id ?? null,
    owner_email: existing.ownerEmail ?? targetVersionRow?.owner_email ?? null,
    active_version: activeVersionRow?.version ?? null,
    manifest: migrateManifest((activeVersionRow || displayVersionRow).manifest),
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

function mapUserProfileRow(row: SupabaseUserProfileRow): UserProfile {
  return {
    userId: row.user_id,
    email: row.email ?? undefined,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapChatSessionMetaRow(row: SupabaseChatSessionRow): ChatSessionMetaRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type ?? undefined,
    starred: row.starred ?? undefined,
    hidden: row.hidden ?? undefined,
    assistantAvatarKey: row.assistant_avatar_key ?? undefined,
    picUrl: row.pic_url ?? undefined,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapChatSessionRow(row: SupabaseChatSessionRow): ChatSessionRecord {
  return {
    ...mapChatSessionMetaRow(row),
    session: row.payload,
  }
}

function mapOAuthTokenRow(row: SupabaseOAuthTokenRow): OAuthTokenRecord {
  return {
    userId: row.user_id,
    appId: row.app_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    scopes: row.scopes || [],
    createdAt: row.created_at,
    lastRefreshedAt: row.last_refreshed_at ?? undefined,
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

function createSupabaseSeedData(): SupabaseSeedData {
  const now = Date.now()
  const weatherAppUrl = getConfiguredWeatherAppUrl()
  const weatherAllowedOrigins = getAllowedOriginsForLaunchUrl(weatherAppUrl)

  const manifests = ([
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
          description: 'Retrieve a read-only summary of the student classroom workload.',
        },
      ],
    },
  ] satisfies AppManifest[]).map((manifest) => migrateManifest(manifest))

  const appVersions: AppVersionRecord[] = manifests.map((manifest) => ({
    appId: manifest.appId,
    version: manifest.version,
    manifest,
    reviewState: 'approved',
    submittedAt: now,
    reviewedAt: now,
    ownerUserId: 'system-demo',
    ownerEmail: 'demo@chatbridge.local',
  }))

  const registryEntries: AppRegistryEntry[] = manifests.map((manifest) => ({
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

function buildVersionRecordId(appId: string, version: string) {
  return `${appId}:${version}`
}

function buildOAuthTokenRowId(userId: string, appId: string, provider: OAuthTokenRecord['provider']) {
  return `${userId}:${appId}:${provider}`
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
