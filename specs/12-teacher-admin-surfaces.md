# Epic 12: Teacher & Admin Surfaces

## Dependencies

- Depends on: `04-approval-and-governance.md`, `09-auth-and-access-control.md`, `11-persistence-and-app-sessions.md`
- Informs: `14-developer-registration-portal.md`

## Status

- Implemented now:
  - session-local internal control plane for registration, review, and allowlisting
- Not implemented yet:
  - dedicated admin registry surface
  - dedicated teacher class-management surface
  - role-backed navigation and access control in production UI

## Context

The current control plane is session-local and useful for internal testing, but real users need dedicated teacher and admin surfaces. Platform review, teacher allowlisting, and app visibility should not depend on a single chat session page.

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

## Out of Scope

- public marketing or marketplace browsing pages
- developer submission flows
- district-wide policy administration
