import type { BridgeAppContext, Session, SessionBridgeState } from '@shared/types'
import { getSupabaseAuthHeaders } from '@/packages/supabase'
import * as chatStore from '@/stores/chatStore'

export const DEFAULT_CHATBRIDGE_CLASS_ID = 'demo-class'
const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'

type BridgeSessionApiResponse = {
  sessionId: string
  bridgeState?: SessionBridgeState
  updatedAt?: number
}

function normalizeBridgeState(bridgeState: SessionBridgeState | undefined): SessionBridgeState | undefined {
  if (!bridgeState) {
    return undefined
  }

  return {
    ...bridgeState,
    activeClassId: bridgeState.activeClassId || DEFAULT_CHATBRIDGE_CLASS_ID,
    appContext: bridgeState.appContext || {},
  }
}

export function getSessionBridgeState(session: Session): SessionBridgeState {
  return {
    ...session.bridgeState,
    activeClassId: session.bridgeState?.activeClassId || DEFAULT_CHATBRIDGE_CLASS_ID,
    appContext: session.bridgeState?.appContext || {},
  }
}

async function fetchBridgeSessionStateFromBackend(sessionId: string) {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}/api/sessions/${sessionId}/bridge-state`, {
    headers: {
      ...authHeaders,
    },
  })

  if (!response.ok) {
    throw new Error(`ChatBridge session request failed: ${response.status}`)
  }

  return (await response.json()) as BridgeSessionApiResponse
}

async function persistBridgeSessionStateToBackend(sessionId: string, bridgeState: SessionBridgeState) {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}/api/sessions/${sessionId}/bridge-state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      bridgeState,
    }),
  })

  if (!response.ok) {
    throw new Error(`ChatBridge session persistence failed: ${response.status}`)
  }

  return (await response.json()) as BridgeSessionApiResponse
}

async function syncBridgeStateToBackend(sessionId: string, bridgeState: SessionBridgeState) {
  try {
    const response = await persistBridgeSessionStateToBackend(sessionId, bridgeState)
    const canonicalBridgeState = normalizeBridgeState(response.bridgeState)

    if (!canonicalBridgeState) {
      return bridgeState
    }

    await chatStore.updateSessionCache(sessionId, (currentSession) => ({
      ...currentSession,
      bridgeState: canonicalBridgeState,
    }))

    return canonicalBridgeState
  } catch (error) {
    console.warn('Failed to persist ChatBridge session state', error)
    return bridgeState
  }
}

export async function hydrateBridgeStateFromBackend(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return undefined
  }

  try {
    const response = await fetchBridgeSessionStateFromBackend(sessionId)
    const backendBridgeState = response.bridgeState
    if (!backendBridgeState) {
      return undefined
    }

    const normalized = normalizeBridgeState(backendBridgeState)
    if (!normalized) {
      return undefined
    }

    const current = getSessionBridgeState(session)
    if (JSON.stringify(current) === JSON.stringify(normalized)) {
      return normalized
    }

    await chatStore.updateSessionCache(sessionId, (currentSession) => ({
      ...currentSession,
      bridgeState: normalized,
    }))

    return normalized
  } catch (error) {
    console.warn('Failed to hydrate ChatBridge session state', error)
    return undefined
  }
}

export async function activateBridgeApp(sessionId: string, appId: string) {
  const nextSession = await chatStore.updateSessionCache(sessionId, (session) => {
    const bridgeState = getSessionBridgeState(session)
    const existing = bridgeState.appContext[appId]
    return {
      ...session,
      bridgeState: {
        ...bridgeState,
        activeAppId: appId,
        appContext: {
          ...bridgeState.appContext,
          [appId]: {
            appId,
            status: 'active',
            summary: existing?.summary,
            lastState: existing?.lastState,
            lastEventAt: Date.now(),
            lastError: undefined,
          },
        },
      },
    }
  })

  const canonicalBridgeState = await syncBridgeStateToBackend(sessionId, getSessionBridgeState(nextSession))
  if (canonicalBridgeState === nextSession.bridgeState) {
    return nextSession
  }

  return {
    ...nextSession,
    bridgeState: canonicalBridgeState,
  }
}

export async function closeBridgeApp(sessionId: string) {
  const nextSession = await chatStore.updateSessionCache(sessionId, (session) => {
    const bridgeState = getSessionBridgeState(session)
    return {
      ...session,
      bridgeState: {
        ...bridgeState,
        activeAppId: undefined,
      },
    }
  })

  const canonicalBridgeState = await syncBridgeStateToBackend(sessionId, getSessionBridgeState(nextSession))
  if (canonicalBridgeState === nextSession.bridgeState) {
    return nextSession
  }

  return {
    ...nextSession,
    bridgeState: canonicalBridgeState,
  }
}

export async function updateBridgeAppContext(sessionId: string, appId: string, nextState: Partial<BridgeAppContext>) {
  const nextSession = await chatStore.updateSessionCache(sessionId, (session) => {
    const bridgeState = getSessionBridgeState(session)
    const previous = bridgeState.appContext[appId]
    return {
      ...session,
      bridgeState: {
        ...bridgeState,
        activeAppId: bridgeState.activeAppId || appId,
        appContext: {
          ...bridgeState.appContext,
          [appId]: {
            appId,
            status: 'idle',
            ...previous,
            ...nextState,
            lastEventAt: nextState.lastEventAt || Date.now(),
          },
        },
      },
    }
  })

  const canonicalBridgeState = await syncBridgeStateToBackend(sessionId, getSessionBridgeState(nextSession))
  if (canonicalBridgeState === nextSession.bridgeState) {
    return nextSession
  }

  return {
    ...nextSession,
    bridgeState: canonicalBridgeState,
  }
}
