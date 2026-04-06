# Epic 12: Teacher, School Admin & Platform Admin Surfaces

## Dependencies

- Depends on: `04-approval-and-governance.md`, `09-auth-and-access-control.md`, `11-persistence-and-app-sessions.md`, `17-role-based-authorization-and-class-membership.md`
- Informs: `14-developer-registration-portal.md`

## Status

- Implemented now:
  - dedicated ChatBridge workspace in Settings for developer registration, platform review, school approval, class allowlisting, and review history
  - session page runtime surfaces limited to the ChatBridge shelf and active app panel
- Not implemented yet:
  - role-backed navigation and route access control in production UI
  - hiding `Settings -> ChatBridge` from students
  - a working teacher-only class activation flow based on backend-readable school approval state
  - status parity and test coverage for the new role-scoped workspace

## Context

The current runtime no longer needs a full governance control plane embedded inside a live tutoring session. Platform review, school approval, teacher class activation, and app visibility should live in dedicated settings/admin surfaces, while the session page should stay focused on the app shelf, active app panel, and conversation.

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
- Non-admin users do not see or control platform review actions.

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

### US-12.2: School admins can manage school app approval outside a live session

**As a** school admin,  
**I want** to enable and disable platform-approved apps for my school,  
**so that** teachers only see apps my school has accepted.

#### Acceptance Criteria

- School admins can view platform-approved apps.
- School admins can enable/disable apps for their school.
- Teachers only see school-enabled apps as candidates for class activation.
- School admins cannot mutate another school’s governance state.
- School admins do not see unrelated teacher, developer, or platform-admin controls unless they separately hold those roles.

#### Testing

- Integration tests verify school allowlist mutations require school-admin or platform-admin privileges.
- Manual test confirms enabling an app for one school does not affect another school.

#### Spec

**School-admin surface must support:**

```text
school selector limited to owned schools
platform-approved app list
per-school enable/disable controls
clear suspended/unapproved status
last change attribution
```

---

### US-12.3: Teachers can manage class app activation outside a live session

**As a** teacher,  
**I want** to enable and disable school-approved apps for a class I teach from a dedicated class surface,  
**so that** class configuration is not tied to an active TutorMeAI chat.

#### Acceptance Criteria

- Teachers can view class-eligible apps.
- Teachers can enable/disable approved apps for a class.
- The app shelf and tool exposure respect class settings after changes.
- Teachers cannot enable suspended or unapproved apps.
- Teachers cannot enable apps for classes they do not teach.
- Teachers cannot enable apps that the school has not approved.
- Teachers do not need school-admin privileges to understand which apps are school-approved for their taught classes.

#### Testing

- Integration tests verify class allowlist mutations require teacher/admin privileges.
- Manual test confirms class changes are reflected in a student session afterward.

#### Spec

**Teacher surface must support:**

```
class selector
school-approved app list
per-class enable/disable controls
clear suspended/unapproved status
last change attribution
```

---

### US-12.4: Admin and teacher UIs expose meaningful status and failure signals

**As a** teacher or admin,  
**I want** to see review state, enablement state, and major runtime problems,  
**so that** I can understand whether an app is available and healthy.

#### Acceptance Criteria

- Admin UI shows review state per app.
- School-admin UI shows school enablement state per app.
- Teacher UI shows class enablement state per app.
- Major suspension or failure signals are visible in the relevant surfaces.

#### Testing

- Manual test confirms suspended apps are clearly marked and not enableable by teachers.

---

### US-12.5: Live sessions stay runtime-focused

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

---

### US-12.6: Students do not have access to Settings -> ChatBridge

**As a** student,  
**I want** TutorMeAI to hide governance settings that are not relevant to me,  
**so that** I only see the runtime ChatBridge shelf during tutoring and not the control plane.

#### Acceptance Criteria

- Students do not see `Settings -> ChatBridge` in navigation.
- Direct navigation to `/settings/chatbridge` is blocked or redirected for students.
- Students still retain access to the runtime ChatBridge shelf and active app panel when their class is entitled to apps.
- Student accounts do not see school-admin, teacher, developer, or platform-admin governance controls.

#### Testing

- Manual test confirms a student account can use class-approved apps in session but cannot open `Settings -> ChatBridge`.
- Integration or UI tests verify teacher, school-admin, developer, and platform-admin accounts still reach their permitted ChatBridge settings surfaces.

## Out of Scope

- public marketing or marketplace browsing pages
- developer submission flows
- district-wide policy administration
