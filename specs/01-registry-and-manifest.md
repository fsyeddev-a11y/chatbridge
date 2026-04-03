# Epic 1: Registry & Manifest Schema

## Context

The registry is the source of truth for which apps exist on the platform and what they're allowed to do. Today, `registry.ts` is a hardcoded in-memory array of `ChatBridgeAppDefinition` objects. The manifest schema (`BridgeAppManifestSchema` in `session.ts`) captures runtime fields but lacks approval metadata, safety policy fields, and LLM context policy.

This epic turns the registry into a persistent, validated, manifest-driven system that third-party developers submit to and the platform enforces at runtime.

---

## User Stories

### US-1.1: Developer submits an app manifest

**As a** third-party developer,
**I want to** submit a JSON manifest describing my app's identity, tools, permissions, and safety declarations,
**so that** the ChatBridge platform can evaluate and onboard my app without custom code.

#### Acceptance Criteria

- Developer submits a manifest conforming to the `BridgeAppManifest` schema via a registration endpoint (or CLI tool in MVP).
- Submission is validated against the full manifest schema. Invalid manifests are rejected with field-level errors.
- A new manifest creates a registry entry with `reviewState: 'pending'`.
- Re-submitting an existing `appId` with a bumped `version` creates a new version pending review; the prior approved version remains active until the new one is approved.

#### Spec

**Manifest schema** (extends current `BridgeAppManifestSchema`):

```
Required fields:
  appId             string    Unique identifier (kebab-case, 3-64 chars)
  name              string    Display name (max 80 chars)
  version           string    Semver string
  description       string    Short description (max 300 chars)
  developerName     string
  developerEmail    string    Contact email
  executionModel    enum      'iframe' | 'server-side'
  authType          enum      'none' | 'api-key' | 'oauth2'
  tools             array     BridgeToolManifest[]
  allowedOrigins    string[]  Origins permitted for postMessage
  coppaCompliant    boolean
  ferpaCompliant    boolean
  contentPolicyAgreed boolean
  privacyPolicyUrl  string    URL to developer's privacy policy

Optional fields:
  launchUrl         string    Entry URL for iframe apps
  subjectTags       string[]
  gradeBand         string    e.g. 'K-5', '6-8', '9-12', 'K-12'
  ageRating         string
  oauthProvider     string    Required if authType is 'oauth2' (e.g. 'google')
  oauthScopes       string[]  Required if authType is 'oauth2'
  stateSchema       object    JSON Schema for STATE_UPDATE payloads
  completionSchema  object    JSON Schema for APP_COMPLETE payloads
  llmSafeFields     string[]  Dot-path fields allowed into LLM context
  llmSummaryTemplate string   Mustache/handlebars template for LLM summaries
  heartbeatTimeoutMs number   Max ms between heartbeats before bridge considers app hung
  uiCapabilities    object    { minHeight, maxHeight, resizable }
  dataRetentionPolicy string
  supportContact    string
```

**BridgeToolManifest schema** (extends current):

```
Required fields:
  name              string    Tool name (snake_case, prefixed with 'chatbridge_')
  description       string    LLM-facing description (max 200 chars)

Optional fields:
  parameters        object    JSON Schema for tool input
  returns           object    JSON Schema for tool output
  requiresAuth      boolean   Whether this tool needs an authenticated session
```

**Validation rules:**
- `appId` must be globally unique across all versions.
- `tools[].name` must start with `chatbridge_` and be unique within the manifest.
- `allowedOrigins` must not contain `'*'`.
- If `authType` is `'oauth2'`, both `oauthProvider` and `oauthScopes` must be present, and `oauthScopes` must be non-empty.
- If the app emits `STATE_UPDATE` or `APP_COMPLETE` messages in normal operation, `stateSchema` and `completionSchema` are required.
- `llmSafeFields` paths must reference keys defined in `stateSchema` (if provided).

---

### US-1.2: Registry persists across sessions

**As a** platform operator,
**I want** the app registry to be persisted to a database (or local JSON store in MVP),
**so that** registered apps survive restarts and are the single source of truth.

#### Acceptance Criteria

- Registry entries are read from persistent storage on startup.
- In-memory registry is a cache; writes go to storage first.
- The `getChatBridgeApps`, `getApprovedChatBridgeAppsForClass`, and `getChatBridgeAppById` functions read from this cache.
- MVP: file-backed JSON store. Production: database-backed.

#### Spec

**Storage model:**

```
AppRegistryEntry {
  manifest:       BridgeAppManifest   // The full validated manifest
  reviewState:    'pending' | 'approved' | 'rejected' | 'suspended'
  registeredAt:   number              // Timestamp
  reviewedAt:     number | null
  reviewNotes:    string | null
  activeVersion:  string              // Currently live semver
  versions:       VersionEntry[]      // History
}

VersionEntry {
  version:     string
  manifest:    BridgeAppManifest
  submittedAt: number
  reviewState: 'pending' | 'approved' | 'rejected'
}
```

**File-backed MVP path:** `~/.chatbridge/registry.json` or embedded in the Chatbox data directory.

---

### US-1.3: Registry exposes approved tools to the LLM

**As the** TutorMeAI platform,
**I want** the LLM toolset to be dynamically generated from the registry based on class-level approval,
**so that** the model can only invoke tools for apps the student is allowed to use.

#### Acceptance Criteria

- `getChatBridgeToolSet()` reads from the persistent registry, not hardcoded data.
- Only apps with `reviewState: 'approved'` AND an active `ClassAppAllowlist` entry matching the session's `activeClassId` produce tools.
- Tool descriptions include auth requirements and app metadata.
- If an app's manifest defines `parameters` on a tool, the generated AI tool uses that schema as `inputSchema`.

#### Spec

**Tool generation rules:**
- Tool name = manifest `tools[].name` (already namespaced with `chatbridge_` prefix).
- Tool description = `buildChatBridgeToolDescription()` output, incorporating manifest description, auth notes, and subject tags.
- Tool input schema = `tools[].parameters` if defined, otherwise `z.object({})`.
- Tool execute function = activate app, update context, return Bridge-authored result.
- Class approval is resolved by joining approved manifests with the canonical `ClassAppAllowlist` store, not by reading class IDs from the manifest registry entry.

**LLM context injection:**
- System prompt section lists approved apps, their tools, and current bridge state.
- Active app summary uses `llmSummaryTemplate` from manifest if provided, otherwise falls back to `appContext.summary`.
- Only fields listed in `llmSafeFields` from the current `appContext.lastState` are included in the summary.

---

### US-1.4: Manifest versioning and safe updates

**As a** third-party developer,
**I want to** submit updated versions of my manifest without disrupting active sessions,
**so that** I can iterate on my app while students continue using the current version.

#### Acceptance Criteria

- A new version submission does not replace the active version until approved.
- Active sessions continue using the version that was live when the session started.
- The registry tracks version history per app.
- Downgrading to a previous approved version is supported by the platform admin.

#### Spec

- Session records the `appVersion` in `bridgeState.appContext[appId]` at activation time.
- Registry lookup for a session can pin to a specific version.
- Version transitions are logged in the registry's `versions` array.
- Teacher/class allowlists are keyed by `(classId, appId, version policy)` so newly approved versions do not silently bypass existing classroom review expectations.
