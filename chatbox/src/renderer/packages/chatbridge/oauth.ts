import { useQuery } from '@tanstack/react-query'
import { getSupabaseAuthHeaders } from '@/packages/supabase'
import queryClient from '@/stores/queryClient'

const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'

type OAuthStatusResponse = {
  appId: string
  provider: 'google'
  connected: boolean
  expiresAt?: number
  scopes: string[]
}

type OAuthStartResponse = {
  appId: string
  provider: 'google'
  authUrl: string
}

type OAuthPopupMessage = {
  source: 'chatbridge-oauth'
  appId: string
  provider: 'google'
  sessionId?: string
  success: boolean
  error?: string
}

export const ChatBridgeOAuthQueryKeys = {
  status: (appId: string) => ['chatbridge', 'oauth-status', appId],
}

export async function fetchChatBridgeOAuthStatus(appId: string): Promise<OAuthStatusResponse> {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}/api/oauth/apps/${appId}/status`, {
    headers: {
      ...authHeaders,
    },
  })

  if (!response.ok) {
    throw new Error(`ChatBridge OAuth status request failed: ${response.status}`)
  }

  return (await response.json()) as OAuthStatusResponse
}

export function useChatBridgeOAuthStatus(appId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ChatBridgeOAuthQueryKeys.status(appId || 'unknown'),
    queryFn: () => fetchChatBridgeOAuthStatus(appId || ''),
    staleTime: 15_000,
    enabled: Boolean(appId) && enabled,
  })
}

export async function startChatBridgeOAuthFlow(appId: string, sessionId?: string) {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}/api/oauth/apps/${appId}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ sessionId }),
  })

  if (!response.ok) {
    throw new Error(`ChatBridge OAuth start request failed: ${response.status}`)
  }

  const payload = (await response.json()) as OAuthStartResponse
  const popup = window.open(payload.authUrl, 'chatbridge-oauth', 'popup,width=540,height=720')
  if (!popup) {
    throw new Error('The OAuth popup was blocked. Please allow popups and try again.')
  }

  const result = await new Promise<OAuthPopupMessage>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('OAuth authorization timed out.'))
    }, 120_000)

    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new Error('OAuth authorization was cancelled.'))
      }
    }, 500)

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin && event.origin !== new URL(CHATBRIDGE_API_ORIGIN).origin) {
        return
      }
      const data = event.data as Partial<OAuthPopupMessage>
      if (data?.source !== 'chatbridge-oauth' || data.appId !== appId) {
        return
      }
      cleanup()
      resolve(data as OAuthPopupMessage)
    }

    function cleanup() {
      window.clearTimeout(timeout)
      window.clearInterval(poll)
      window.removeEventListener('message', onMessage)
      if (!popup.closed) {
        popup.close()
      }
    }

    window.addEventListener('message', onMessage)
  })

  await queryClient.invalidateQueries({ queryKey: ChatBridgeOAuthQueryKeys.status(appId) })

  if (!result.success) {
    throw new Error(result.error || 'OAuth authorization failed.')
  }

  return result
}

export async function revokeChatBridgeOAuthToken(appId: string) {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}/api/oauth/apps/${appId}/revoke`, {
    method: 'POST',
    headers: {
      ...authHeaders,
    },
  })

  if (!response.ok) {
    throw new Error(`ChatBridge OAuth revoke request failed: ${response.status}`)
  }

  await queryClient.invalidateQueries({ queryKey: ChatBridgeOAuthQueryKeys.status(appId) })
}
