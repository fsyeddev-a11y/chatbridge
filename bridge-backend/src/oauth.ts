import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AppManifest, OAuthProvider, OAuthTokenRecord } from './types.js'

type FetchLike = typeof fetch

type OAuthProviderConfig = {
  provider: OAuthProvider
  clientId: string
  clientSecret: string
  authEndpoint: string
  tokenEndpoint: string
  revokeEndpoint?: string
  supportedScopes: string[]
}

type OAuthStatePayload = {
  appId: string
  provider: OAuthProvider
  userId: string
  sessionId?: string
  returnOrigin: string
  scopes: string[]
  nonce: string
  exp: number
}

export type OAuthStartResult = {
  provider: OAuthProvider
  authUrl: string
}

export type OAuthCallbackSuccess = {
  appId: string
  provider: OAuthProvider
  userId: string
  sessionId?: string
  returnOrigin: string
  record: OAuthTokenRecord
}

export type OAuthService = {
  getProviderConfig(provider: OAuthProvider): OAuthProviderConfig | undefined
  createAuthorizationRequest(input: {
    app: AppManifest
    userId: string
    sessionId?: string
    returnOrigin: string
  }): OAuthStartResult
  handleCallback(input: { code: string; state: string }): Promise<OAuthCallbackSuccess>
  revokeToken(input: { provider: OAuthProvider; accessToken: string }): Promise<void>
}

export function createConfiguredOAuthService(fetchImpl: FetchLike = fetch): OAuthService {
  return {
    getProviderConfig(provider) {
      return getConfiguredOAuthProvider(provider)
    },
    createAuthorizationRequest(input) {
      const provider = requireOAuthProvider(input.app)
      const providerConfig = getRequiredOAuthProviderConfig(provider)
      validateRequestedScopes(providerConfig, input.app.oauthScopes || [])

      const callbackUrl = getConfiguredOAuthCallbackUrl()
      const state = signOAuthState({
        appId: input.app.appId,
        provider,
        userId: input.userId,
        sessionId: input.sessionId,
        returnOrigin: input.returnOrigin,
        scopes: input.app.oauthScopes || [],
        nonce: randomBytes(12).toString('hex'),
        exp: Date.now() + 10 * 60 * 1000,
      })

      const authUrl = new URL(providerConfig.authEndpoint)
      authUrl.searchParams.set('client_id', providerConfig.clientId)
      authUrl.searchParams.set('redirect_uri', callbackUrl)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', (input.app.oauthScopes || []).join(' '))
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')

      return {
        provider,
        authUrl: authUrl.toString(),
      }
    },
    async handleCallback(input) {
      const state = verifyOAuthState(input.state)
      const providerConfig = getRequiredOAuthProviderConfig(state.provider)
      const callbackUrl = getConfiguredOAuthCallbackUrl()

      const tokenResponse = await fetchImpl(providerConfig.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: callbackUrl,
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret,
        }),
      })

      if (!tokenResponse.ok) {
        throw new Error(`OAuth token exchange failed: ${tokenResponse.status}`)
      }

      const payload = (await tokenResponse.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        scope?: string
      }

      if (!payload.access_token) {
        throw new Error('OAuth token exchange did not return an access token.')
      }

      const scopes = payload.scope ? payload.scope.split(/\s+/).filter(Boolean) : state.scopes
      const now = Date.now()

      return {
        appId: state.appId,
        provider: state.provider,
        userId: state.userId,
        sessionId: state.sessionId,
        returnOrigin: state.returnOrigin,
        record: {
          userId: state.userId,
          appId: state.appId,
          provider: state.provider,
          accessToken: encryptOAuthSecret(payload.access_token),
          refreshToken: payload.refresh_token ? encryptOAuthSecret(payload.refresh_token) : undefined,
          expiresAt: payload.expires_in ? now + payload.expires_in * 1000 : undefined,
          scopes,
          createdAt: now,
          lastRefreshedAt: now,
        },
      }
    },
    async revokeToken(input) {
      const providerConfig = getRequiredOAuthProviderConfig(input.provider)
      if (!providerConfig.revokeEndpoint) {
        return
      }

      await fetchImpl(providerConfig.revokeEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: input.accessToken,
        }),
      })
    },
  }
}

export function buildOAuthPopupResultHtml(input: {
  success: boolean
  appId: string
  provider: OAuthProvider
  targetOrigin: string
  sessionId?: string
  error?: string
}) {
  const payload = JSON.stringify({
    source: 'chatbridge-oauth',
    appId: input.appId,
    provider: input.provider,
    sessionId: input.sessionId,
    success: input.success,
    error: input.error,
  })

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ChatBridge OAuth</title>
  </head>
  <body>
    <script>
      const payload = ${payload};
      const targetOrigin = ${JSON.stringify(input.targetOrigin)};
      if (window.opener && targetOrigin) {
        window.opener.postMessage(payload, targetOrigin);
      }
      window.close();
    </script>
    <p>${input.success ? 'Authorization complete. You can close this window.' : 'Authorization failed. You can close this window.'}</p>
  </body>
</html>`
}

export function decryptStoredOAuthToken(value: string) {
  return decryptOAuthSecret(value)
}

function requireOAuthProvider(app: AppManifest): OAuthProvider {
  if (app.authType !== 'oauth2' || !app.oauthProvider) {
    throw new Error(`App ${app.appId} is not configured for OAuth.`)
  }

  return app.oauthProvider
}

function getConfiguredOAuthProvider(provider: OAuthProvider): OAuthProviderConfig | undefined {
  if (provider !== 'google') {
    return undefined
  }

  const clientId = process.env.CHATBRIDGE_GOOGLE_OAUTH_CLIENT_ID || ''
  const clientSecret = process.env.CHATBRIDGE_GOOGLE_OAUTH_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) {
    return undefined
  }

  return {
    provider: 'google',
    clientId,
    clientSecret,
    authEndpoint: process.env.CHATBRIDGE_GOOGLE_OAUTH_AUTH_ENDPOINT || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: process.env.CHATBRIDGE_GOOGLE_OAUTH_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token',
    revokeEndpoint: process.env.CHATBRIDGE_GOOGLE_OAUTH_REVOKE_ENDPOINT || 'https://oauth2.googleapis.com/revoke',
    supportedScopes: (
      process.env.CHATBRIDGE_GOOGLE_OAUTH_SUPPORTED_SCOPES ||
      [
        'https://www.googleapis.com/auth/classroom.courses.readonly',
        'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      ].join(',')
    )
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
  }
}

function getRequiredOAuthProviderConfig(provider: OAuthProvider) {
  const config = getConfiguredOAuthProvider(provider)
  if (!config) {
    throw new Error(`OAuth provider ${provider} is not configured.`)
  }
  return config
}

function validateRequestedScopes(providerConfig: OAuthProviderConfig, scopes: string[]) {
  const supportedScopes = new Set(providerConfig.supportedScopes)
  for (const scope of scopes) {
    if (!supportedScopes.has(scope)) {
      throw new Error(`Scope ${scope} is not supported by the configured ${providerConfig.provider} OAuth provider.`)
    }
  }
}

function getConfiguredOAuthCallbackUrl() {
  const origin = process.env.CHATBRIDGE_PUBLIC_BACKEND_ORIGIN || 'http://localhost:8787'
  return `${origin.replace(/\/$/, '')}/oauth/callback`
}

function signOAuthState(payload: OAuthStatePayload) {
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = createHmac('sha256', getOAuthStateSecret()).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

function verifyOAuthState(state: string): OAuthStatePayload {
  const [encodedPayload, signature] = state.split('.')
  if (!encodedPayload || !signature) {
    throw new Error('Invalid OAuth state.')
  }

  const expected = createHmac('sha256', getOAuthStateSecret()).update(encodedPayload).digest('base64url')
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error('Invalid OAuth state signature.')
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload)) as OAuthStatePayload
  if (payload.exp < Date.now()) {
    throw new Error('OAuth state has expired.')
  }
  return payload
}

function encryptOAuthSecret(value: string) {
  const key = getOAuthTokenEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
}

function decryptOAuthSecret(value: string) {
  const [ivBase64, tagBase64, encryptedBase64] = value.split('.')
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Stored OAuth secret is malformed.')
  }
  const decipher = createDecipheriv('aes-256-gcm', getOAuthTokenEncryptionKey(), Buffer.from(ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedBase64, 'base64')), decipher.final()]).toString('utf8')
}

function getOAuthStateSecret() {
  return process.env.CHATBRIDGE_OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'chatbridge-dev-state-secret'
}

function getOAuthTokenEncryptionKey() {
  const source = process.env.CHATBRIDGE_OAUTH_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'chatbridge-dev-token-secret'
  return createHash('sha256').update(source).digest()
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}
