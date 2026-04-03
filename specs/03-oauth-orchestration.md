# Epic 3: OAuth Orchestration

## Context

Some third-party apps (e.g., Google Classroom Assistant) need authenticated access to external services. The core design principle is that the platform owns the entire OAuth lifecycle — the iframe never sees tokens. Today, the toolset marks `authType: 'oauth2'` apps and sets `requiresAuthorization: true` in tool results, but no actual OAuth flow exists.

This epic builds the platform-owned OAuth orchestration layer.

---

## User Stories

### US-3.1: Student connects an OAuth-protected app

**As a** student,
**I want to** connect my Google account when a ChatBridge app needs it,
**so that** the app can access my classroom data without me sharing my password with the app.

#### Acceptance Criteria

- When an OAuth-requiring app is activated and no valid token exists, the Bridge prompts the student to authorize.
- The consent screen opens in a popup or new tab (never inside the iframe).
- After authorization, the student is redirected back to the Bridge backend.
- The app iframe receives an `AUTH_RESULT` message with `success: true` (no tokens).
- The student can use the app immediately after authorization.

#### Spec

**OAuth flow sequence:**

```
1. Student activates an oauth2 app (via shelf or LLM tool invocation)
2. Bridge checks: does a valid token exist for (userId, appId, oauthProvider)?
   - Yes → send INIT to iframe, then proceed normally
   - No  → continue to step 3
3. Bridge opens consent popup:
   URL: /bridge/auth/start?appId={appId}&provider={oauthProvider}&sessionId={sessionId}
4. Backend builds the OAuth authorization URL:
   - client_id from platform config (NOT from the app manifest)
   - redirect_uri = {bridge_backend}/bridge/auth/callback
   - provider = manifest.oauthProvider
   - scope = manifest.oauthScopes
   - state = signed JWT containing { appId, sessionId, userId, nonce }
5. User authorizes in the popup
6. Provider redirects to /bridge/auth/callback with code + state
7. Backend validates state JWT, exchanges code for access_token + refresh_token
8. Backend stores tokens server-side: TokenStore(userId, appId, provider)
9. Backend closes popup via redirect to a success page that calls window.close()
10. Bridge sends AUTH_RESULT { success: true, provider: oauthProvider } to the app iframe
11. App can now make tool invocations that require auth — backend attaches tokens
```

**Security constraints:**
- `client_id` and `client_secret` are platform secrets, never in the manifest.
- The `state` parameter is a signed JWT to prevent CSRF.
- Tokens are stored server-side only, encrypted at rest.
- The iframe never receives tokens in any message.
- Popup uses `noopener` to prevent the consent page from accessing the opener window.
- `oauthProvider` must be explicitly declared in the manifest. The Bridge never guesses the provider from scopes or app identity.

---

### US-3.2: Token refresh happens silently

**As the** ChatBridge platform,
**I want** expired tokens to be refreshed automatically before tool invocations,
**so that** students are not interrupted by re-authorization prompts during a session.

#### Acceptance Criteria

- Before executing a tool that requires auth, the backend checks token expiry.
- If the access token is expired but a refresh token exists, the backend refreshes silently.
- If the refresh token is also invalid, the student is prompted to re-authorize (same flow as US-3.1).
- Token refresh failures are logged and reported to the Bridge as a tool execution error.

#### Spec

**Token lifecycle:**

```
TokenRecord {
  userId:         string
  appId:          string
  provider:       string      // manifest.oauthProvider, e.g. 'google'
  accessToken:    string      // encrypted
  refreshToken:   string      // encrypted
  expiresAt:      number      // Unix timestamp
  scopes:         string[]
  createdAt:      number
  lastRefreshedAt: number
}
```

**Refresh logic (runs before tool execution):**

```
1. Look up TokenRecord for (userId, appId, provider)
2. If not found → return AuthRequired error
3. If expiresAt > now + 60s → token is valid, attach to request
4. If refreshToken exists:
   a. Call provider's token endpoint with refresh_token grant
   b. On success: update accessToken, expiresAt, lastRefreshedAt
   c. On failure (invalid_grant): delete TokenRecord, return AuthRequired error
5. If no refreshToken → return AuthRequired error
```

**AuthRequired error handling:**
- The tool execution returns a structured error: `{ error: 'auth_required', provider, appId }`.
- The LLM is informed that the app needs re-authorization and should ask the student to connect.
- The Bridge can trigger the consent popup automatically or wait for student action (configurable per app).

---

### US-3.3: Student revokes app access

**As a** student,
**I want to** disconnect my Google account from a ChatBridge app,
**so that** I'm in control of what apps have access to my data.

#### Acceptance Criteria

- The ChatBridge shelf or panel provides a "Disconnect" action for OAuth-connected apps.
- Disconnecting deletes the stored tokens for that (userId, appId, provider).
- The app iframe receives an `AUTH_RESULT` with `success: false, error: 'revoked'`.
- Subsequent tool invocations requiring auth trigger a re-authorization prompt.

#### Spec

- Revocation endpoint: `POST /bridge/auth/revoke` with `{ appId, provider }`.
- Backend deletes the `TokenRecord` and optionally calls the provider's revocation endpoint.
- The UI shows connection status on each app card in the shelf: "Connected" badge or "Connect" button.
- Connection status is derived from whether a valid `TokenRecord` exists (checked via a lightweight status endpoint, not by exposing token details).

---

### US-3.4: Platform owns OAuth client credentials

**As a** platform operator,
**I want** all OAuth client credentials to be platform-managed,
**so that** third-party developers never handle student authentication directly.

#### Acceptance Criteria

- OAuth `client_id` and `client_secret` are stored in platform configuration, not in app manifests.
- The manifest only declares `authType: 'oauth2'`, `oauthProvider`, and `oauthScopes`.
- The platform maps (provider → client credentials) in a secure config store.
- Third-party developers cannot override or specify their own OAuth clients.

#### Spec

**Platform OAuth config:**

```
OAuthProviderConfig {
  provider:      string       // e.g. 'google', 'microsoft'
  clientId:      string
  clientSecret:  string       // encrypted
  tokenEndpoint: string
  authEndpoint:  string
  revokeEndpoint: string | null
  supportedScopes: string[]   // Scopes the platform has registered for
}
```

- Apps requesting scopes not in `supportedScopes` are rejected at manifest submission time.
- MVP supports Google as the only provider. The config structure supports adding more providers later.
- Provider configs are stored in environment variables or a secrets manager, never in the database or filesystem alongside app data.
