# Epic 19: Entitlement-Aware Runtime Class Bootstrap

## Dependencies

- Depends on: `11-persistence-and-app-sessions.md`, `17-role-based-authorization-and-class-membership.md`, `18-school-hierarchy-and-scoped-governance.md`
- Informs: `10-backend-owned-generation-and-streaming.md`, `12-teacher-admin-surfaces.md`

## Status

- Implemented now:
  - runtime shelf no longer relies on `demo-class`
  - missing `activeClassId` renders safe guidance instead of an unusable empty shelf
  - missing persisted `activeClassId` can bootstrap to a deterministic real entitled class during session hydration
  - invalid persisted or stale local `activeClassId` is cleared through backend-aware validation and then follows the same entitlement-aware bootstrap path
- Not implemented yet:
  - backend-defined preferred-class selection contract for runtime initialization
  - consistent recovery behavior when a previously persisted class is no longer valid

## Context

Removing the demo fallback fixed an authorization problem, but it also exposed a real runtime gap: some new or migrated sessions can load without a persisted `activeClassId`. The current behavior is safe because ChatBridge does not load class-scoped apps until a valid class is selected, but it is still incomplete because the session does not recover automatically from the user’s real entitlements.

This epic defines the follow-up work needed to bootstrap ChatBridge runtime class context from actual school and class membership without reintroducing fallback defaults.

The intent is:

- no hardcoded demo class
- no unauthorized class inference
- no silent empty runtime when a valid entitled class is available
- no frontend-only class trust

---

## User Stories

### US-19.1: New or migrated sessions can derive a valid active class from real entitlement

**As a** student or teacher,  
**I want** ChatBridge to recover a usable class context when a session has no persisted `activeClassId`,  
**so that** the app shelf and runtime work without requiring an unsafe default class.

#### Acceptance Criteria

- If a session has no persisted `activeClassId`, the product may bootstrap one only from classes the current user is entitled to use.
- Bootstrap must use real backend membership and governance data, not seeded demo values or frontend guesses alone.
- If exactly one valid entitled class is available, the runtime may auto-select it.
- If multiple valid entitled classes are available, the product should use a deterministic selection rule or require explicit user choice.
- If no valid entitled class is available, the runtime stays inactive and shows clear guidance.
- Any selected class must still pass normal backend entitlement validation before chat, tool, or bridge-state use.

#### Testing

- Integration tests verify a session with missing `activeClassId` auto-recovers only from real entitled classes.
- Integration tests verify a user cannot bootstrap into a class they are not enrolled in or allowed to manage.
- Frontend tests verify the shelf does not render blank when no class is available and can reflect bootstrap guidance correctly.
- Manual test confirms migrated sessions recover without using `demo-class`.

#### Spec

**Bootstrap rule:**

```text
session opens
  -> read persisted bridge state
  -> if activeClassId exists
       validate it on the backend
     else
       derive candidate classes from backend entitlement
       choose from those candidates only
```

**Allowed bootstrap sources:**

```text
student
  enrolled classes with valid platform + school + class app exposure

teacher
  taught classes they can operate

platform_admin
  explicit admin-selected class or deterministic platform-safe bootstrap rule
```

**Disallowed bootstrap sources:**

```text
demo-school
demo-class
frontend hardcoded defaults
class IDs passed without backend validation
```

---

### US-19.2: Runtime initialization has a backend-owned class selection contract

**As a** platform engineer,  
**I want** class bootstrap behavior defined by a backend-owned contract,  
**so that** session initialization remains secure and consistent across frontend clients.

#### Acceptance Criteria

- The backend exposes enough membership-derived runtime context for the frontend to initialize safely.
- The frontend does not infer entitlement from stale local state alone.
- Backend responses can distinguish:
  - valid persisted class
  - no persisted class but bootstrap candidate available
  - no valid candidate available
- If a persisted class is no longer valid, the runtime clears it and follows the same bootstrap flow.

#### Testing

- Contract tests verify backend responses for each initialization state.
- Integration tests verify invalid persisted class values are rejected and replaced only through entitlement-aware bootstrap.

#### Spec

**Suggested response shape:**

```text
runtime_class_context
  persisted_class_id?
  validated_class_id?
  bootstrap_candidate_class_ids[]
  recommended_class_id?
  reason                // persisted_valid | persisted_invalid | missing | none_available
```

**Design rule:**
- The frontend may render chooser UX or accept a recommended class.
- The backend remains authoritative for which classes are valid candidates.

---

### US-19.3: Missing or invalid class state fails safely and visibly

**As a** user,  
**I want** clear guidance when ChatBridge cannot determine a valid class,  
**so that** the product is understandable instead of appearing broken.

#### Acceptance Criteria

- If no valid class can be chosen, the shelf and panel show explicit no-class-selected guidance.
- The UI does not expand into an empty state that looks like a loading or rendering bug.
- The runtime does not query class-scoped app lists until a valid class is known.
- Guidance text distinguishes between:
  - no class selected yet
  - no entitled classes available
  - previously saved class is no longer valid

#### Testing

- Frontend tests verify guidance copy renders for missing class state.
- Frontend tests verify class-scoped queries remain disabled until a valid class exists.
- Manual test confirms invalid persisted class state does not expose apps or tools.

#### Spec

**Failure-safe runtime behavior:**

```text
no valid class
  -> no app list query
  -> no tool exposure
  -> no bridge-state writes using class scope
  -> visible guidance to select or recover class context
```

## Out of Scope

- district-level rostering
- SIS sync strategy
- automatic cross-session class preference heuristics beyond deterministic entitlement-safe rules
