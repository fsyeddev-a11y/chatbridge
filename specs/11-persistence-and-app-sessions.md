# Epic 11: Persistence & App Sessions

## Dependencies

- Depends on: `04-approval-and-governance.md`, `08-observability-and-tracing.md`, `09-auth-and-access-control.md`
- Informs: `10-backend-owned-generation-and-streaming.md`, `12-teacher-admin-surfaces.md`, `13-real-app-integrations.md`

## Status

- Implemented now:
  - Supabase/Postgres-backed control-plane persistence
  - backend-owned bridge app/session state
  - app-context snapshot persistence
  - backend-owned chat session persistence for signed-in web users
- Not implemented yet:
  - richer normalized message storage and server-side search
  - full role-aware session visibility and sharing rules
  - explicit durable `closed`/`terminated` app lifecycle state

## Context

The current Bridge backend still relies on a file-backed store for registry entries, allowlists, and audit events, while active app state still leans on frontend session state. That is acceptable for internal prototyping, but not for a durable educational platform. This epic defines the shift to Supabase/Postgres-backed persistence and backend-owned app/session state.

---

## User Stories

### US-11.1: Core Bridge data is stored durably in Postgres

**As a** platform engineer,  
**I want** registry, approvals, allowlists, audit events, and app sessions stored in Postgres,  
**so that** ChatBridge survives restarts and supports real operations.

#### Acceptance Criteria

- File-backed storage is replaced by durable database-backed storage.
- Registry entries persist across deploys and backend restarts.
- Teacher allowlists persist across deploys and backend restarts.
- Audit events persist across deploys and backend restarts.
- The backend can boot without data loss from ephemeral local files.

#### Testing

- Integration tests verify writes survive process restart.
- Migration tests verify seeded/local dev data can be upgraded safely.
- Manual test confirms a redeploy does not wipe registry or allowlist data.

#### Spec

**Initial database tables:**

```
apps
app_versions
review_actions
class_allowlists
audit_events
chat_sessions
user_profiles
oauth_tokens
app_context_snapshots
bridge_sessions
```

**Recommended ownership split:**

```
Supabase Auth
  users

Bridge backend / Postgres
  apps
  app_versions
  review_actions
  class_allowlists
  audit_events
  app_sessions
  app_context_snapshots
```

---

### US-11.2: Active app state is backend-owned

**As a** platform engineer,  
**I want** the canonical app session state to live on the backend,  
**so that** the frontend becomes a runtime shell rather than the source of truth.

#### Acceptance Criteria

- Active app/session state is persisted server-side.
- The backend stores the latest safe `appContext` summary and state snapshot.
- The frontend can reconnect and recover active app state from backend truth.
- App state written to the transcript/LLM context is derived from backend state, not volatile iframe memory.

#### Testing

- Integration tests verify app state survives page refresh.
- Manual test confirms reopening a session restores the active app and latest summary.
- Validation tests verify only schema-approved state is persisted.

#### Spec

**State ownership model:**

```
iframe:
  volatile UI state only

frontend:
  runtime view state

backend:
  canonical app session state
  canonical app context summary
```

**Design rule:**
- The iframe may propose state.
- The backend decides what is durable, safe, and model-visible.

---

### US-11.3: Session/app reconciliation works after disconnects and reloads

**As a** student,  
**I want** TutorMeAI to recover gracefully if I refresh the page or lose connection,  
**so that** my conversation and app session do not disappear.

#### Acceptance Criteria

- A page reload restores chat history and active app state.
- If an app was active before reload, the frontend can rehydrate the panel from backend state.
- If the iframe app itself cannot resume, TutorMeAI surfaces the last safe summary and continues chat.

#### Testing

- Manual test verifies reload recovery for the Weather app.
- Future manual tests verify recovery for long-lived apps like Chess and Story Builder.

#### Spec

**Reconnect flow:**

```
frontend opens session
  -> GET backend session/app state
  -> rehydrate active app panel
  -> send fresh INIT to iframe with canonical last-safe state
  -> continue from backend summary if iframe cannot resume
```

---

### US-11.4: Backend persistence is compatible with Supabase Auth and audit needs

**As a** platform owner,  
**I want** stored records to relate cleanly to authenticated users and future school/org data,  
**so that** permissions and audit history remain coherent.

#### Acceptance Criteria

- Records can be associated with user IDs and roles.
- Audit records can be queried by user, session, app, and class.
- Sensitive credential material remains excluded from normal relational event payloads.
- Signed-in users only load their own persisted conversations on login.

#### Testing

- Schema tests verify required foreign-key or reference fields exist for user/session relations.
- Manual query checks verify audit records can be filtered by user and class.

---

### Future Spec Note: Distinguish user-closed apps from completed apps

**Why this needs a future spec**

Today, manually closing an app clears `activeAppId`, but it does not create a distinct durable terminal state such as `closed` or `terminated`. That means backend snapshots can correctly show that no app is currently open, while the last stored `appContext.status` may still read as `ready` or `active`. This is acceptable for the current prototype, but it is not expressive enough for long-term audit, recovery, and UX semantics.

**Future requirements**

- The platform should distinguish:
  - app finished its task (`complete`)
  - app failed (`error`)
  - app was explicitly closed by the student or teacher (`closed` / `terminated`)
- Manual close actions should produce durable metadata or status transitions in backend session persistence and app-context snapshots.
- LLM-visible summaries should be able to tell the difference between:
  - "the app completed"
  - "the app is unavailable"
  - "the app was closed by the user"
- Audit and snapshot queries should support filtering for user-closed apps separately from completed sessions.

**Dependencies**

- Depends on: `02-postmessage-protocol.md`, `05-error-recovery-and-resilience.md`, `08-observability-and-tracing.md`
- Informs: future lifecycle/audit refinement work under this epic and `05-error-recovery-and-resilience.md`

**Acceptance Criteria for the future slice**

- Closing an app creates a durable backend-visible state change distinct from `complete`.
- Reload recovery reflects that the app was previously closed, not completed.
- Snapshot history and audit events record manual close actions explicitly.
- TutorMeAI can continue without the app while preserving correct semantic history.

## Out of Scope

- analytics warehouse design
- long-term archival policy
- district SIS integration
