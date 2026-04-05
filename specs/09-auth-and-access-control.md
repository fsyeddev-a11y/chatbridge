# Epic 9: Auth & Access Control

## Dependencies

- Depends on: none
- Informs: `10-backend-owned-generation-and-streaming.md`, `11-persistence-and-app-sessions.md`, `12-teacher-admin-surfaces.md`, `14-developer-registration-portal.md`, `15-rate-limiting-and-abuse-controls.md`, `17-role-based-authorization-and-class-membership.md`, `18-school-hierarchy-and-scoped-governance.md`

## Status

- Implemented now:
  - Supabase sign-in gate for deployed web
  - no public sign-up for current internal testing
  - bearer-token verification on protected `bridge-backend` routes
  - backend-owned user profile creation on authenticated requests
  - initial user-role foundation with global roles and scoped memberships in progress
  - `GET /api/me` profile surface for future role-aware UI
- Not implemented yet:
  - full school-scoped route enforcement for privileged actions
  - complete school and class enrollment model
  - separate teacher, student, school admin, platform admin, and developer account experiences
  - detailed role, school, and class enforcement, specified in `17-role-based-authorization-and-class-membership.md` and `18-school-hierarchy-and-scoped-governance.md`

## Context

TutorMeAI can no longer rely on local browser provider settings or anonymous access. The deployed web app already uses Supabase sign-in for internal testers, but the long-term system needs a formal access-control contract: who can sign in, what global roles exist, what school and class memberships exist, what routes are protected, and how the Bridge backend verifies identity before allowing model access, app control, or admin actions.

This epic defines the access-control model for ChatBridge and TutorMeAI.

---

## User Stories

### US-9.1: Only authenticated users can access TutorMeAI

**As a** platform owner,  
**I want** the deployed app to require sign-in before the user can interact with TutorMeAI,  
**so that** model access, student data, and Bridge APIs are never publicly exposed.

#### Acceptance Criteria

- The web app blocks access to the main application until a valid auth session exists.
- Public sign-up can be disabled for internal-only testing.
- Protected Bridge backend routes reject missing or invalid bearer tokens with `401`.
- Only explicit public routes remain unauthenticated, such as `/health` and CORS `OPTIONS`.

#### Testing

- Unit tests verify bearer token parsing and `401` behavior for protected backend routes.
- Frontend tests verify the sign-in gate renders when no session is present.
- Manual test verifies an unauthenticated user cannot invoke ChatBridge APIs directly from the browser.

#### Spec

**Current auth model (internal testing):**

```
Frontend:
  Supabase sign-in with shared tester credentials

Backend:
  Verify Supabase bearer token on every /api/* route

Public routes:
  /health
  OPTIONS preflight
```

**Design rule:**
- The frontend may hold user session tokens.
- The frontend may never hold privileged backend secrets.
- The backend is the final authority on whether a request is allowed.

---

### US-9.2: Access control distinguishes user roles and responsibilities

**As a** platform engineer,  
**I want** the system to distinguish students, teachers, admins, and developers,  
**so that** Bridge actions can be permissioned correctly.

#### Acceptance Criteria

- The auth model supports:
  - global roles:
    - `platform_admin`
    - `developer`
  - scoped memberships:
    - `school_admin`
    - `teacher`
    - `student`
- Role checks happen on the backend before privileged actions are allowed.
- Platform review actions require admin privileges.
- School allowlist changes require school-admin or platform-admin privileges.
- Teacher class allowlist changes require teacher-for-class or platform-admin privileges.
- Developer registration actions require developer or admin privileges.

#### Testing

- Unit tests cover role-based allow/deny checks for privileged routes.
- Integration tests verify the wrong role cannot mutate review state or allowlists.
- Manual test confirms a student account cannot access admin-only views.

#### Spec

**Role and membership model:**

```
platform_admin
  - global platform governance
  - approve/suspend/reject apps
  - view platform-wide audit and registry state

developer
  - submit and manage owned manifests
  - view review feedback for owned apps

school_admin
  - manage school-scoped app approval
  - manage school-scoped teacher/student/class state

teacher
  - manage class activation for classes they teach

student
  - use approved apps for enrolled classes
```

**MVP note:**
- Internal testing may begin with a shared authenticated account.
- Production-grade role separation must still be modeled explicitly.
- The current implementation bootstraps a user profile on first authenticated request and assigns a default role based on configured email allowlists or a safe fallback role. Route enforcement is a follow-on slice.

**Initial authorization matrix:**

```
student
  - GET chat session state
  - POST chat generation
  - use approved apps

teacher
  - everything student can do
  - mutate class allowlists for taught classes

school_admin
  - read school governance state
  - mutate school app approvals for owned school

platform_admin
  - everything school_admin can do
  - mutate review state
  - view platform-wide audit and registry data

developer
  - submit owned manifests
  - view owned app review state
```

---

### US-9.3: Auth and access control protect model access

**As a** platform owner,  
**I want** the LLM API key to remain backend-only and callable only by authorized users,  
**so that** TutorMeAI cannot be abused as an open model proxy.

#### Acceptance Criteria

- The frontend never sends requests directly to the LLM provider.
- The LLM API key exists only in backend environment variables.
- Chat generation routes require authentication.
- Unauthorized requests do not reach model provider APIs.

#### Testing

- Unit tests verify protected chat routes reject unauthenticated requests.
- Manual test verifies the browser never contains the provider API key.
- Manual network inspection confirms chat traffic goes through `bridge-backend`, not directly to OpenAI.

#### Spec

**Allowed model access path:**

```
Browser
  -> bridge-backend /api/chat/*
  -> LLM provider
```

**Forbidden model access path:**

```
Browser
  -> OpenAI / any provider directly
```

---

### US-9.4: Internal testing mode remains low-friction without compromising the architecture

**As a** product team,  
**I want** a low-friction internal testing login flow,  
**so that** we can test quickly without building the full production school identity model first.

#### Acceptance Criteria

- Public sign-up can be disabled.
- Shared internal test accounts can sign in successfully.
- Backend auth enforcement remains identical whether the account is shared or individualized.
- The auth model can later evolve to per-user and per-school accounts without redesigning the backend boundary.

#### Testing

- Manual test verifies shared internal login works end-to-end.
- Manual test verifies disabling sign-up prevents new public account creation.

#### Spec

**Internal testing mode:**

```
Supabase Auth
  - public sign-up disabled
  - one or more manually created testers

TutorMeAI frontend
  - sign-in gate before app access

Bridge backend
  - identical auth verification regardless of whether accounts are shared or individual
```

## Out of Scope

- classroom roster sync
- parent/guardian access
- SSO and school district identity federation
- district hierarchy
