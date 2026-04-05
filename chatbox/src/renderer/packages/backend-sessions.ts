import type { Session, SessionMeta } from '@shared/types'
import { migrateSession } from '@/utils/session-utils'
import { getSupabaseAuthHeaders } from './supabase'

const CHATBRIDGE_API_ORIGIN = (process.env.CHATBRIDGE_API_ORIGIN || '').replace(/\/$/, '')

function getBackendSessionsUrl(path = '') {
  if (!CHATBRIDGE_API_ORIGIN) {
    throw new Error('ChatBridge backend origin is not configured.')
  }

  return `${CHATBRIDGE_API_ORIGIN}/api/chat-sessions${path}`
}

export async function listBackendSessionsMeta() {
  const headers = await getSupabaseAuthHeaders()
  const response = await fetch(getBackendSessionsUrl(), {
    headers,
  })

  if (!response.ok) {
    throw new Error(`Failed to list backend sessions (${response.status})`)
  }

  const payload = (await response.json()) as { sessions: SessionMeta[] }
  return payload.sessions || []
}

export async function getBackendSession(sessionId: string) {
  const headers = await getSupabaseAuthHeaders()
  const response = await fetch(getBackendSessionsUrl(`/${encodeURIComponent(sessionId)}`), {
    headers,
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to load backend session ${sessionId} (${response.status})`)
  }

  const payload = (await response.json()) as { session: Session }
  return payload.session ? migrateSession(payload.session) : null
}

export async function upsertBackendSession(session: Session, previousSessionId?: string) {
  const headers = await getSupabaseAuthHeaders()
  const response = await fetch(getBackendSessionsUrl(`/${encodeURIComponent(session.id)}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      session,
      previousSessionId,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to save backend session ${session.id} (${response.status})`)
  }

  const payload = (await response.json()) as {
    session: Session
    meta: SessionMeta
  }

  return {
    session: migrateSession(payload.session),
    meta: payload.meta,
  }
}

export async function deleteBackendSession(sessionId: string) {
  const headers = await getSupabaseAuthHeaders()
  const response = await fetch(getBackendSessionsUrl(`/${encodeURIComponent(sessionId)}`), {
    method: 'DELETE',
    headers,
  })

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    throw new Error(`Failed to delete backend session ${sessionId} (${response.status})`)
  }

  return true
}

export async function reorderBackendSessions(sessionIds: string[]) {
  const headers = await getSupabaseAuthHeaders()
  const response = await fetch(getBackendSessionsUrl('/reorder'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      sessionIds,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to reorder backend sessions (${response.status})`)
  }

  const payload = (await response.json()) as { sessions: SessionMeta[] }
  return payload.sessions || []
}
