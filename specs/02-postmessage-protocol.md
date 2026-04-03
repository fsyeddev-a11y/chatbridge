# Epic 2: PostMessage Protocol

## Context

The postMessage protocol is the only communication channel between third-party apps (running in sandboxed iframes) and the ChatBridge runtime. Today, `ChatBridgePanel.tsx` implements a `BridgeEnvelope` type and handles four message types (`APP_READY`, `STATE_UPDATE`, `APP_COMPLETE`, `APP_ERROR`). This works but is undocumented, lacks host-to-app messaging, has no schema validation against the manifest, and doesn't support the full lifecycle third-party developers need.

This epic defines the complete, versioned, bidirectional postMessage contract that third-party developers build against.

---

## User Stories

### US-2.1: App sends lifecycle events to the Bridge

**As a** third-party app developer,
**I want** a clearly defined set of message types I can send to the host,
**so that** my app can communicate state changes through a predictable contract.

#### Acceptance Criteria

- All app-to-host messages use the `BridgeEnvelope` format.
- The Bridge validates every incoming message against the envelope schema before processing.
- Messages with unknown `type`, missing required fields, or mismatched `appId` are silently dropped.
- Messages from disallowed origins are silently dropped.

#### Spec

**App-to-Host Envelope (v1.0):**

```typescript
type AppToHostEnvelope = {
  source: 'chatbridge-app'       // Required literal — identifies this as a bridge message
  version: '1.0'                 // Protocol version
  appId: string                  // Must match the app's registered appId
  type: AppToHostMessageType
  payload?: Record<string, unknown>
  correlationId?: string         // Optional — ties a response to a host-initiated request
}

type AppToHostMessageType =
  | 'APP_READY'        // App has processed INIT and is ready to receive user-facing commands
  | 'STATE_UPDATE'     // App is reporting a meaningful state change
  | 'APP_COMPLETE'     // App has finished its task
  | 'APP_ERROR'        // App encountered an unrecoverable error
  | 'HEARTBEAT'        // App is alive (response to host PING or periodic)
  | 'AUTH_REQUEST'     // App is requesting the host initiate an OAuth flow
  | 'RESIZE_REQUEST'   // App is requesting a height change for its iframe
```

**Message type payloads:**

| Type | Required Payload Fields | Optional Payload Fields |
|------|------------------------|------------------------|
| `APP_READY` | — | `summary: string` |
| `STATE_UPDATE` | `state: object` | `summary: string` |
| `APP_COMPLETE` | `state: object` | `summary: string` |
| `APP_ERROR` | `error: string` | `code: string`, `recoverable: boolean` |
| `HEARTBEAT` | — | — |
| `AUTH_REQUEST` | `provider: string` | `scopes: string[]` |
| `RESIZE_REQUEST` | `height: number` | — |

**Validation rules:**
- `STATE_UPDATE` and `APP_COMPLETE` payloads are validated against the manifest's `stateSchema` / `completionSchema`. If the relevant schema is missing, the message is rejected.
- `RESIZE_REQUEST.height` must be within `uiCapabilities.minHeight` and `uiCapabilities.maxHeight` from the manifest. Out-of-range values are clamped.
- `AUTH_REQUEST.provider` must match the manifest's `oauthProvider`. An `AUTH_REQUEST` from a non-OAuth app is dropped.

---

### US-2.2: Bridge sends commands to the app

**As the** ChatBridge platform,
**I want** to send commands to the app iframe,
**so that** the Bridge can initialize apps, relay tool invocations, and manage the app lifecycle.

#### Acceptance Criteria

- Host-to-app messages use a `HostToAppEnvelope` format.
- Messages are sent via `iframe.contentWindow.postMessage()` to the app's registered origin only (never `'*'` in production).
- Apps can distinguish host messages from other sources via the `source` field.

#### Spec

**Host-to-App Envelope (v1.0):**

```typescript
type HostToAppEnvelope = {
  source: 'chatbridge-host'      // Required literal
  version: '1.0'
  appId: string
  type: HostToAppMessageType
  payload?: Record<string, unknown>
  correlationId?: string          // Ties to a pending response expectation
}

type HostToAppMessageType =
  | 'INIT'              // Sent after iframe loads — provides app config and session context
  | 'TOOL_INVOKE'       // Bridge is invoking one of the app's registered tools
  | 'PING'              // Heartbeat check — app should respond with HEARTBEAT
  | 'SUSPEND'           // App should pause and save state
  | 'RESUME'            // App should restore from last known state
  | 'TERMINATE'         // App should clean up — iframe will be removed
  | 'AUTH_RESULT'       // OAuth flow completed — reports success or failure (no tokens)
```

**Message type payloads:**

| Type | Payload Fields |
|------|---------------|
| `INIT` | `sessionId: string`, `classId: string`, `locale: string`, `theme: 'light' \| 'dark'`, `previousState?: object` |
| `TOOL_INVOKE` | `toolName: string`, `parameters: object`, `correlationId: string` |
| `PING` | — |
| `SUSPEND` | — |
| `RESUME` | `previousState?: object` |
| `TERMINATE` | `reason: string` |
| `AUTH_RESULT` | `success: boolean`, `provider: string`, `error?: string` |

**Behavioral contract:**
- `INIT` is sent exactly once after the iframe `load` event and before the app is considered ready. If the app was previously active in this session, `previousState` contains the last validated `appContext.lastState`.
- `APP_READY` is sent by the app only after it has processed `INIT` and finished any startup work needed to safely accept user interaction.
- `TOOL_INVOKE` expects the app to respond with a `STATE_UPDATE` or `APP_ERROR` carrying the same `correlationId`. Timeout: manifest's `heartbeatTimeoutMs` or default 10000ms.
- `PING` expects a `HEARTBEAT` response within 5000ms.
- `TERMINATE` is a courtesy notification. The iframe may be removed regardless of whether the app responds.
- `AUTH_RESULT` never contains tokens. It only tells the app whether auth succeeded so it can update its UI. The Bridge handles token usage server-side.

---

### US-2.3: Protocol versioning

**As a** third-party developer,
**I want** the protocol to be versioned,
**so that** my app continues working when the Bridge adds new message types in the future.

#### Acceptance Criteria

- Every envelope includes a `version` field.
- The Bridge handles messages based on the declared version.
- Unknown message types in a known version are ignored (forward-compatible).
- If the Bridge drops support for a version, apps declaring that version get a `TERMINATE` with `reason: 'unsupported_protocol_version'`.

#### Spec

- Version format: `major.minor` (e.g., `'1.0'`).
- Minor bumps add new optional message types. Apps on that major version continue to work.
- Major bumps may remove or change message semantics. Apps must update.
- The manifest declares `postmessageSchemaVersion` (default `'1.0'`). The Bridge checks compatibility at iframe load time.
- MVP ships with `'1.0'` only.

---

### US-2.4: Origin validation and security

**As the** ChatBridge platform,
**I want** strict origin checking on all postMessage traffic,
**so that** only the registered app can communicate with the Bridge.

#### Acceptance Criteria

- Incoming messages are checked against the app's `allowedOrigins` from the manifest.
- Messages from unrecognized origins are dropped silently.
- Host-to-app messages target the specific origin, not `'*'` (except for `srcdoc` iframes in development which use `'null'`).
- `allowedOrigins` cannot contain `'*'`.

#### Spec

- `isAllowedOrigin()` already exists in `ChatBridgePanel.tsx`. Extend it to:
  - Support wildcard subdomains for development (e.g., `*.localhost:3000`) — configurable, disabled in production.
  - Log dropped messages (origin, type, appId) for audit/debugging.
- For `srcdoc` iframes (mock/dev mode), origin is `'null'` (string). This is only allowed when the app's `allowedOrigins` explicitly includes `'null'`.
- Production apps must declare real HTTPS origins.

---

### US-2.5: State update schema enforcement

**As the** ChatBridge platform,
**I want** incoming `STATE_UPDATE` and `APP_COMPLETE` payloads validated against the manifest's declared schema,
**so that** apps cannot inject arbitrary data into the Bridge state.

#### Acceptance Criteria

- If the manifest declares a `stateSchema`, the Bridge validates `payload.state` against it before storing.
- Invalid payloads are rejected: the Bridge keeps the previous valid state and logs the violation.
- If no `stateSchema` or `completionSchema` is declared for a stateful app, the Bridge rejects `STATE_UPDATE` and `APP_COMPLETE` payloads entirely.
- `payload.summary` is always sanitized (stripped of HTML, truncated to 500 chars).

#### Spec

- Schema validation uses JSON Schema (draft 2020-12), same as the manifest's `stateSchema` field.
- Validation runs synchronously in the message handler before `updateBridgeAppContext()` is called.
- `STATE_UPDATE` requires a declared `stateSchema`. `APP_COMPLETE` requires a declared `completionSchema`.
- Apps that do not declare those schemas may still send non-stateful messages such as `APP_READY`, `APP_ERROR`, `HEARTBEAT`, `AUTH_REQUEST`, and `RESIZE_REQUEST`.
- Sanitization of `summary`:
  - Strip HTML tags.
  - Truncate to 500 characters.
  - Reject if it contains patterns matching common prompt injection signatures (configurable blocklist).
- Failed validations produce a `console.warn` in development and an audit log entry in production.
