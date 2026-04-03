# Epic 6: Developer SDK & Integration Interface

## Context

Third-party developers build apps in their own repos against the ChatBridge contract. They need: a manifest schema to validate against, a client library to handle the postMessage protocol, TypeScript types for type-safe development, and a way to test their app locally against a mock Bridge host.

This epic defines what ships from this repo to serve external developers.

---

## User Stories

### US-6.1: Developer validates their manifest locally

**As a** third-party developer,
**I want** to validate my app manifest against the official schema before submitting,
**so that** I catch errors early and don't waste time on rejected submissions.

#### Acceptance Criteria

- This repo publishes a JSON Schema file for the manifest (machine-readable, draft 2020-12).
- This repo publishes a TypeScript type package (`@chatbridge/types`) that developers can install.
- A CLI validation command is available: `npx @chatbridge/cli validate manifest.json`.
- Validation produces clear, field-level error messages.

#### Spec

**Published artifacts:**

```
@chatbridge/types          (npm package)
  - BridgeAppManifest      TypeScript type
  - BridgeToolManifest     TypeScript type
  - BridgeEnvelope         TypeScript type (app-to-host)
  - HostToAppEnvelope      TypeScript type (host-to-app)
  - BridgeAppContext        TypeScript type
  - AppToHostMessageType   Union type
  - HostToAppMessageType   Union type
  - manifest.schema.json   JSON Schema file

@chatbridge/cli            (npm package)
  - validate               Validates a manifest JSON file
  - init                   Scaffolds a new manifest with required fields
```

**Source location in this repo:**
- Types are derived from the Zod schemas in `chatbox/src/shared/types/session.ts`.
- A build step generates the JSON Schema and `.d.ts` files from the Zod source.
- The CLI is a lightweight wrapper around the schema validation.

---

### US-6.2: Developer uses a client SDK to communicate with the Bridge

**As a** third-party developer,
**I want** a lightweight JavaScript SDK that handles the postMessage protocol for me,
**so that** I don't have to manually construct envelopes or manage message listeners.

#### Acceptance Criteria

- This repo publishes `@chatbridge/sdk` — a zero-dependency browser library.
- The SDK handles envelope construction, origin validation, and message routing.
- The SDK provides event emitters for host-to-app messages (INIT, TOOL_INVOKE, PING, etc.).
- The SDK auto-responds to PING with HEARTBEAT.
- The SDK works in any framework (React, Vue, vanilla JS) — no framework dependency.

#### Spec

**SDK API surface:**

```typescript
import { ChatBridgeClient } from '@chatbridge/sdk'

const bridge = new ChatBridgeClient({
  appId: 'my-app-id',
  version: '1.0',              // Protocol version
  allowedOrigins: ['https://tutormeai.com'],
})

// Lifecycle
bridge.on('init', (payload) => {
  // Read session/class context first, then declare readiness
  bridge.ready({ summary: 'App initialized and ready.' })
})
bridge.updateState({ state: { ... }, summary: '...' })
bridge.complete({ state: { ... }, summary: '...' })
bridge.error({ error: 'Something went wrong', recoverable: false })
bridge.requestAuth({ provider: 'google' })
bridge.requestResize({ height: 400 })

// Receive host commands
bridge.on('toolInvoke', (payload) => { /* { toolName, parameters, correlationId } */ })
bridge.on('suspend', () => { /* save state */ })
bridge.on('resume', (payload) => { /* { previousState? } */ })
bridge.on('terminate', (payload) => { /* { reason } — clean up */ })
bridge.on('authResult', (payload) => { /* { success, provider, error? } */ })

// Automatic behaviors
// - Responds to PING with HEARTBEAT (no developer action needed)
// - Validates outgoing envelopes before sending
// - Logs warnings for invalid incoming messages in dev mode

// Cleanup
bridge.destroy()  // Removes all event listeners
```

**Build output:**
- ESM and CJS bundles.
- TypeScript declarations included.
- Total size target: < 5KB gzipped.
- No runtime dependencies.

---

### US-6.3: Developer tests their app against a mock Bridge

**As a** third-party developer,
**I want** to run my app locally against a simulated Bridge host,
**so that** I can test the full postMessage lifecycle without deploying to TutorMeAI.

#### Acceptance Criteria

- This repo provides a dev harness that hosts the developer's app in an iframe and simulates the Bridge.
- The harness sends `INIT`, `TOOL_INVOKE`, `PING`, and lifecycle messages.
- The harness displays received messages in a debug panel.
- The harness validates incoming messages against the developer's manifest schema.
- The harness can be started with a single command: `npx @chatbridge/cli dev --manifest manifest.json --url http://localhost:3000`.

#### Spec

**Dev harness features:**

```
┌──────────────────────────────────────────────┐
│  ChatBridge Dev Harness                       │
├──────────────────┬───────────────────────────┤
│                  │                           │
│  Control Panel   │   App Iframe              │
│                  │   (developer's app)       │
│  [Send INIT]     │                           │
│  [Send PING]     │                           │
│  [Invoke Tool ▾] │                           │
│  [Suspend]       │                           │
│  [Terminate]     │                           │
│                  │                           │
├──────────────────┴───────────────────────────┤
│  Message Log (bidirectional)                  │
│  ← APP_READY { summary: "..." }             │
│  → INIT { sessionId: "test-123", ... }       │
│  ← STATE_UPDATE { state: {...} }            │
│  ⚠ Validation error: state.foo is required  │
└──────────────────────────────────────────────┘
```

**Harness implementation:**
- A standalone HTML page served by the CLI's dev server.
- Loads the developer's manifest to know which tools exist and what schemas to validate against.
- Embeds the developer's app URL in a sandboxed iframe (same sandbox flags as production).
- All Bridge-side logic (envelope validation, origin checking, state tracking) runs in the harness, giving the developer confidence their app will work in production.

---

### US-6.4: Developer understands the integration contract through docs

**As a** third-party developer,
**I want** clear documentation explaining how ChatBridge works and what I need to build,
**so that** I can create a compliant app without guessing.

#### Acceptance Criteria

- A `docs/` directory in this repo contains integration documentation.
- Documentation covers: manifest format, postMessage protocol, tool registration, OAuth (from the app's perspective), error handling expectations, and testing with the dev harness.
- Each doc references the relevant spec for deeper detail.
- A quickstart guide walks through creating a minimal app end-to-end.

#### Spec

**Documentation structure:**

```
docs/
  getting-started.md        Quickstart: minimal app in < 30 minutes
  manifest-reference.md     Full manifest field reference with examples
  protocol-reference.md     PostMessage protocol: all message types, payloads, sequences
  tools-guide.md            How to define and respond to tool invocations
  oauth-guide.md            What app devs need to know about OAuth (they don't handle tokens)
  testing-guide.md          Using the dev harness and writing integration tests
  error-handling.md         What the Bridge expects when things go wrong
  faq.md                    Common questions and gotchas
```

**Quickstart outline:**
1. Create `manifest.json` with required fields
2. Install `@chatbridge/sdk`
3. Initialize `ChatBridgeClient` in your app
4. Handle `init` event first, then call `bridge.ready()`
5. Respond to `toolInvoke` with `bridge.updateState()`
6. Test with `npx @chatbridge/cli dev`
7. Submit manifest for review

---

### US-6.5: Published packages stay in sync with the Bridge runtime

**As a** third-party developer,
**I want** the SDK and types packages to always match the Bridge runtime's expectations,
**so that** I don't get silent incompatibilities.

#### Acceptance Criteria

- Types, SDK, and JSON Schema are generated from the same Zod source of truth in this repo.
- A CI check ensures the published packages match the current runtime schemas.
- Breaking changes to the protocol bump the major version of all published packages.
- Changelogs are maintained for each package.

#### Spec

**Build pipeline:**

```
chatbox/src/shared/types/session.ts   (Zod schemas — source of truth)
         │
         ├──→ packages/types/         (generated .d.ts + .schema.json)
         ├──→ packages/sdk/           (imports types, implements client)
         └──→ packages/cli/           (imports types, implements validation + dev harness)
```

**CI checks:**
- `build:types` — generate types from Zod, fail if output differs from committed files.
- `test:sdk` — run SDK unit tests against current protocol spec.
- `test:cli` — run CLI validation tests against sample manifests (valid + invalid).
- Version tags: all three packages share a version number tied to protocol version.
