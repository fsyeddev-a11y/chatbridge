# Epic 4: Approval & Governance

## Context

ChatBridge serves K-12 students. Every app that reaches a student should pass through three gates:

1. platform approval
2. school approval
3. teacher/class activation

Today, ChatBridge already has platform review state and class-level allowlisting, but the long-term model also needs a school-scoped gate between them so schools can decide which platform-approved apps are eligible for their teachers.

This epic defines the governance chain. The detailed school hierarchy is specified in `18-school-hierarchy-and-scoped-governance.md`.

---

## User Stories

### US-4.1: Platform admin reviews a submitted app

**As a** platform admin,
**I want to** review pending app submissions and approve, reject, or request changes,
**so that** only safe, compliant apps enter the platform.

#### Acceptance Criteria

- Admin can view all apps with `reviewState: 'pending'`.
- Admin can transition an app to `'approved'`, `'rejected'`, or back to `'pending'` (request changes).
- Admin can add `reviewNotes` explaining the decision.
- Approval timestamps and reviewer identity are recorded.
- Rejected apps are not visible to teachers or students.

#### Spec

**Review state machine:**

```
pending ──→ approved
pending ──→ rejected
approved ─→ suspended    (admin can pull an app post-approval)
suspended → approved     (admin can reinstate)
rejected ─→ pending      (developer resubmits)
```

**Admin review record:**

```
ReviewAction {
  appId:       string
  version:     string
  action:      'approve' | 'reject' | 'suspend' | 'reinstate' | 'request_changes'
  reviewerId:  string
  notes:       string
  timestamp:   number
}
```

**Review checklist (informational, not enforced by code):**
- COPPA/FERPA declarations match actual app behavior
- Privacy policy URL is accessible and adequate
- Declared `oauthScopes` are minimal for stated functionality
- `allowedOrigins` are legitimate domains owned by the developer
- Tool descriptions are accurate and non-manipulative
- `stateSchema` and `llmSafeFields` don't expose sensitive data
- App has been tested in sandbox mode

**MVP implementation:**
- Admin review is a CLI command or simple admin page, not a full portal.
- `reviewState` transitions update the registry store.
- An approved app immediately becomes available for teacher allowlisting.
  In the final model, it first becomes eligible for school approval.

---

### US-4.2: School admin enables a platform-approved app for their school

**As a** school admin,
**I want** to enable a platform-approved app for my school,
**so that** teachers in my school can choose whether to activate it in their own classes.

#### Acceptance Criteria

- School admins see platform-approved apps.
- School admins can enable or disable an app for their school.
- Enabling an app creates or reactivates a `SchoolAppAllowlist` record for `(schoolId, appId)`.
- School approval does not automatically expose the app to every class.
- Teachers in that school can only class-enable apps that are school-enabled.

#### Spec

**School allowlist model:**

```
SchoolAppAllowlist {
  schoolId:     string
  appId:        string
  enabledBy:    string       // School admin userId
  enabledAt:    number
  disabledAt:   number | null
}
```

**Allowlist rules:**
- An app must have `reviewState: 'approved'` to appear in the school catalog.
- A school admin can only manage allowlists for their own school.
- Enabling an app is idempotent.
- School approval is required before class activation.

---

### US-4.3: Teacher enables a school-approved app for their class

**As a** teacher,
**I want to** browse school-approved apps and enable specific ones for a class I teach,
**so that** my students only see apps I've vetted for my curriculum.

#### Acceptance Criteria

- Teachers see a catalog of apps with `reviewState: 'approved'` and active school approval.
- Teachers can enable or disable an app for a specific `classId`.
- Enabling an app creates or reactivates a `ClassAppAllowlist` record for `(classId, appId)`.
- Students in that class immediately see the app in their ChatBridge shelf.
- Teachers can disable an app at any time; it disappears from the shelf and active sessions show a "no longer available" state.
- A teacher can only manage classes they teach.
- Enabling an app for one class does not enable it for the teacher’s other classes.

#### Spec

**Class allowlist model:**

```
ClassAppAllowlist {
  classId:     string
  appId:       string
  enabledBy:   string       // Teacher userId
  enabledAt:   number
  disabledAt:  number | null
  settings:    object | null // Future: per-class app config overrides
}
```

**Allowlist rules:**
- An app must have `reviewState: 'approved'` and active school approval to appear in the teacher catalog.
- A teacher can only manage allowlists for classes they teach.
- Enabling an app is idempotent (re-enabling a disabled app clears `disabledAt`).
- `ClassAppAllowlist` is the canonical source of truth for class-level access. Any derived `enabledClassIds` cache must be recomputed from allowlist data and never hand-edited.
- When an app is disabled mid-session:
  - The active iframe receives `TERMINATE { reason: 'app_disabled' }`.
  - The Bridge clears `activeAppId` if it was the disabled app.
  - The LLM is informed the app is no longer available.

**Teacher UI (MVP):**
- A settings panel within the session or class management area.
- Shows approved apps as cards with toggle switches.
- Displays app metadata: name, description, developer, subject tags, grade band.

---

### US-4.4: Student can only access fully approved apps

**As a** student,
**I want** the ChatBridge shelf to only show apps my school and teacher have approved for my class,
**so that** I don't see or access anything that hasn't been vetted.

#### Acceptance Criteria

- `getApprovedChatBridgeAppsForClass(classId)` returns only apps where:
  - `reviewState === 'approved'`
  - an active `SchoolAppAllowlist` record exists for the class’s school
  - an active `ClassAppAllowlist` record exists for that `classId`
- The LLM toolset only includes tools from apps that passed all required gates.
- If a student tries to invoke a tool for a non-approved app (e.g., via prompt manipulation), the tool does not exist in the toolset and the LLM cannot call it.

#### Spec

This is the intended final rule for `getApprovedChatBridgeAppsForClass()`. The spec here is a guarantee:

- **No bypass paths:** There is no API, tool, or postMessage route that lets a student interact with an app that has not passed platform approval, school approval, and class activation.
- **School gate included:** An app that is platform-approved but not school-enabled does not reach any class in that school.
- **Dynamic updates:** If a teacher disables an app, it is removed from the toolset on the next LLM turn (not mid-generation).
- **Audit trail:** Every app activation is logged with `{ studentId, appId, classId, timestamp }`.
- **Canonical approval source:** The runtime resolves class access from the allowlist table, not from denormalized arrays on registry entries.

---

### US-4.5: Platform admin suspends a live app

**As a** platform admin,
**I want to** suspend an approved app immediately if a safety issue is discovered,
**so that** no student can access a compromised app while we investigate.

#### Acceptance Criteria

- Admin can transition any `'approved'` app to `'suspended'`.
- Suspended apps are immediately removed from all class shelves.
- Active iframes for the suspended app receive `TERMINATE { reason: 'app_suspended' }`.
- The LLM is informed the app is unavailable.
- Teachers see the app marked as "Suspended by platform" in their catalog.
- The admin can reinstate the app once the issue is resolved.

#### Spec

**Suspension propagation:**

```
1. Admin sets reviewState = 'suspended' with notes
2. Registry broadcasts suspension to all active sessions:
   - For each session with activeAppId === suspendedAppId:
     a. Send TERMINATE to iframe
     b. Update appContext.status = 'error'
     c. Update appContext.lastError = 'App suspended by platform'
     d. Clear activeAppId
3. getApprovedChatBridgeAppsForClass() excludes suspended apps
4. getChatBridgeToolSet() excludes suspended app tools
```

**MVP simplification:** Since sessions are client-side, suspension takes effect on next page load or next LLM turn. Real-time propagation via WebSocket is a post-MVP enhancement.
