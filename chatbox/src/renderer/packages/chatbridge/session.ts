import type { BridgeAppContext, Session, SessionBridgeState } from '@shared/types'
import * as chatStore from '@/stores/chatStore'

export const DEFAULT_CHATBRIDGE_CLASS_ID = 'demo-class'

export function getSessionBridgeState(session: Session): SessionBridgeState {
  return {
    ...session.bridgeState,
    activeClassId: session.bridgeState?.activeClassId || DEFAULT_CHATBRIDGE_CLASS_ID,
    appContext: session.bridgeState?.appContext || {},
  }
}

export async function activateBridgeApp(sessionId: string, appId: string) {
  return await chatStore.updateSessionWithMessages(sessionId, (session) => {
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
            status: existing?.status || 'active',
            summary: existing?.summary,
            lastState: existing?.lastState,
            lastEventAt: Date.now(),
            lastError: undefined,
          },
        },
      },
    }
  })
}

export async function closeBridgeApp(sessionId: string) {
  return await chatStore.updateSessionWithMessages(sessionId, (session) => {
    const bridgeState = getSessionBridgeState(session)
    return {
      ...session,
      bridgeState: {
        ...bridgeState,
        activeAppId: undefined,
      },
    }
  })
}

export async function updateBridgeAppContext(sessionId: string, appId: string, nextState: Partial<BridgeAppContext>) {
  return await chatStore.updateSessionWithMessages(sessionId, (session) => {
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
}
