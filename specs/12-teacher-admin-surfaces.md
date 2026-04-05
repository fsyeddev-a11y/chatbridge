# Epic 12: Teacher & Admin Surfaces

## Dependencies

- Depends on: `04-approval-and-governance.md`, `09-auth-and-access-control.md`, `11-persistence-and-app-sessions.md`, `17-role-based-authorization-and-class-membership.md`
- Informs: `14-developer-registration-portal.md`

## Status

- Implemented now:
  - dedicated ChatBridge workspace in Settings for registration, review, allowlisting, and review history
  - session page link-out to the canonical ChatBridge workspace
- Not implemented yet:
  - role-backed navigation and access control in production UI
  - class-scoped teacher views based on real class memberships

## Context

The current runtime no longer needs a full governance control plane embedded inside a live tutoring session. Platform review, teacher allowlisting, and app visibility should live in dedicated settings/admin surfaces, while the session page should stay focused on the app shelf, active app panel, and conversation.

---

## User Stories

### US-12.1: Platform admins can review apps from a dedicated admin surface

**As a** platform admin,  
**I want** to review manifests and change review state from a dedicated interface,  
**so that** platform governance is operationally usable.

#### Acceptance Criteria

- There is an admin-facing registry view outside the chat session page.
- Admins can filter apps by review state.
- Admins can approve, suspend, reject, or inspect app submissions.
- Review actions create durable review-history records.

#### Testing

- Integration tests verify admin-only routes reject non-admin roles.
- Manual test confirms review actions update registry state and history.

#### Spec

**Admin surface must support:**

```
registry list
review state filters
manifest/version detail
review action history
suspend/reject/approve actions
```

---

### US-12.2: Teachers can manage class app allowlists outside a live session

**As a** teacher,  
**I want** to enable and disable approved apps for my class from a dedicated class surface,  
**so that** class configuration is not tied to an active TutorMeAI chat.

#### Acceptance Criteria

- Teachers can view class-eligible apps.
- Teachers can enable/disable approved apps for a class.
- The app shelf and tool exposure respect class settings after changes.
- Teachers cannot enable suspended or unapproved apps.

#### Testing

- Integration tests verify class allowlist mutations require teacher/admin privileges.
- Manual test confirms class changes are reflected in a student session afterward.

#### Spec

**Teacher surface must support:**

```
class selector
approved app list
per-class enable/disable controls
clear suspended/unapproved status
last change attribution
```

---

### US-12.3: Admin and teacher UIs expose meaningful status and failure signals

**As a** teacher or admin,  
**I want** to see review state, enablement state, and major runtime problems,  
**so that** I can understand whether an app is available and healthy.

#### Acceptance Criteria

- Admin UI shows review state per app.
- Teacher UI shows class enablement state per app.
- Major suspension or failure signals are visible in the relevant surfaces.

#### Testing

- Manual test confirms suspended apps are clearly marked and not enableable by teachers.

---

### US-12.4: Live sessions stay runtime-focused

**As a** student or tutor,  
**I want** the session page to focus on the conversation and active apps,  
**so that** governance controls do not clutter the live teaching experience.

#### Acceptance Criteria

- The session page does not render the full registration/review/allowlist control plane inline.
- The session page retains the ChatBridge app shelf and active app panel.
- The session page provides a lightweight path to the canonical `Settings -> ChatBridge` workspace.
- Governance controls are not duplicated across the session page and Settings.

#### Testing

- Manual test confirms the session page no longer shows the full control-plane card.
- Manual test confirms operators can still reach `Settings -> ChatBridge` from the session page.
- Manual test confirms the app shelf and active app panel continue to function.

#### Spec

**Session-page ChatBridge surfaces should be limited to:**

```
app shelf
active app panel
small link or hint to the canonical ChatBridge settings workspace
```

**Design rule:**
- Session UX is runtime-first.
- Governance UX is settings-first.

## Out of Scope

- public marketing or marketplace browsing pages
- developer submission flows
- district-wide policy administration
