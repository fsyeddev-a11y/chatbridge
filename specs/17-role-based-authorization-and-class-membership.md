# Epic 17: Role-Based Authorization, Schools & Class Membership

## Dependencies

- Depends on: `09-auth-and-access-control.md`, `11-persistence-and-app-sessions.md`
- Informs: `03-oauth-orchestration.md`, `12-teacher-admin-surfaces.md`, `13-real-app-integrations.md`, `14-developer-registration-portal.md`, `18-school-hierarchy-and-scoped-governance.md`

## Status

- Implemented now:
  - authenticated user bootstrap through Supabase
  - backend-owned `user_profiles`
  - durable multi-role bootstrap through `user_roles`
  - durable class and class membership bootstrap through `classes` and `class_memberships`
  - user-owned chat session persistence
  - developer-owned app submission and review visibility
  - centralized backend role checks for privileged routes
- Not implemented yet:
  - school-scoped membership and school-admin authorization
  - class-specific teacher ownership enforcement
  - runtime class membership validation for app/session access
  - role-aware frontend navigation and feature visibility
  - admin tooling for role assignment and school/class membership management

## Context

TutorMeAI now has real authentication, but authorization is still only partially modeled. The platform already knows who the signed-in user is, but it does not yet fully separate:

- global roles such as `platform_admin` and `developer`
- school-scoped roles such as `school_admin`
- class-scoped teaching and student membership

This epic defines the authorization model that sits underneath the school hierarchy defined in `18-school-hierarchy-and-scoped-governance.md`.

It answers:

- which roles a user can hold
- how schools, classes, and memberships are modeled
- how backend routes decide `allow` vs `deny`
- how frontend surfaces adapt to role and class scope

---

## User Stories

### US-17.1: Users can hold one or more global roles

**As a** platform engineer,  
**I want** the system to support multiple roles per user,  
**so that** one person can be, for example, both a teacher and a developer without account duplication.

#### Acceptance Criteria

- Role membership is modeled independently from the user profile record.
- A user can hold one or more of:
  - `platform_admin`
  - `developer`
- School and classroom access are modeled separately from global roles.
- The backend resolves effective permissions as the union of assigned roles.
- Legacy single-role values can be migrated into the new role assignment model safely.

#### Testing

- Unit tests verify multi-role resolution and union permission semantics.
- Migration tests verify legacy `admin` / `teacher` / `student` / `developer` profile roles are preserved during migration.
- Manual test confirms one account can hold both `teacher` and `developer` privileges.

#### Spec

**Recommended schema additions:**

```
user_profiles
  user_id
  email
  display_name?
  created_at
  updated_at

user_roles
  id
  user_id
  role
  assigned_by
  assigned_at
  revoked_at?
```

**Global role semantics:**

```
platform_admin
  platform-wide governance and role assignment

developer
  app submission and owned-app lifecycle management
```

**Migration rule:**
- Existing `user_profiles.role` is treated as legacy bootstrap data.
- New authorization checks should read from `user_roles`.
- Legacy `admin` should migrate to canonical `platform_admin`.

---

### US-17.2: School and class memberships determine scoped access

**As a** platform owner,  
**I want** school and class membership to determine who can use or configure scoped apps,  
**so that** students, teachers, and school admins operate against real school and class boundaries instead of a hardcoded demo class.

#### Acceptance Criteria

- Schools are stored durably in backend persistence.
- Classes are stored durably and each belongs to exactly one school.
- A user may be enrolled in multiple classes.
- `school_memberships` distinguish at least:
  - `school_admin`
  - `teacher`
  - `student`
- `class_memberships` distinguish at least:
  - `teacher`
  - `student`
- Only teachers assigned to a class, or platform admins, can mutate that class’s allowlist.
- Only school admins for a school, or platform admins, can mutate that school’s allowlist.
- Students can only use approved apps for classes they are enrolled in.
- `activeClassId` in runtime state is validated against backend membership rules.

#### Testing

- Integration tests verify a school admin cannot mutate another school’s governance state.
- Integration tests verify a teacher cannot mutate a class they do not teach.
- Integration tests verify a student cannot activate class-scoped apps for a class they are not enrolled in.
- Manual test confirms app shelf contents change when class membership changes.

#### Spec

**Recommended schema additions:**

```
schools
  id
  name

school_memberships
  id
  school_id
  user_id
  membership_role   // school_admin | teacher | student
  created_at
  removed_at?

classes
  id
  school_id
  name
  external_ref?
  created_at
  updated_at

class_memberships
  id
  class_id
  user_id
  membership_role   // teacher | student
  created_at
  removed_at?
```

**Scoped authorization rules:**

```
platform_admin
  may read and mutate all schools and classes

school_admin
  may read and mutate only their schools

teacher
  may read school state for their schools
  may mutate only taught classes

student
  may read and use only enrolled classes in their schools

developer
  has no school or class governance rights by role alone
```

**Design rule:**
- App shelf exposure must come from backend-approved apps intersected with backend-validated school approval and class membership.
- The frontend may suggest an active class.
- The backend decides whether that class is valid for the user.

---

### US-17.3: Backend routes enforce authorization centrally

**As a** platform engineer,  
**I want** privileged routes to use one backend authorization layer,  
**so that** policy enforcement is consistent and testable.

#### Acceptance Criteria

- Backend authorization checks are centralized, not re-implemented ad hoc per route.
- Missing auth returns `401`.
- Authenticated but insufficient permission returns `403`.
- Platform review actions require `platform_admin`.
- School allowlist mutations require `school_admin` for that school or `platform_admin`.
- Class allowlist mutations require `teacher` for that class or `platform_admin`.
- Developer manifest submission and owned-app visibility require `developer` or `platform_admin`.

#### Testing

- Unit tests cover `allow` / `deny` behavior for each role and route category.
- Integration tests verify privileged routes return `403` for insufficient permissions.
- Manual test confirms a student account cannot open admin-only surfaces by calling the backend directly.

#### Spec

**Recommended helper layer:**

```
requireAuthenticatedUser()
requireAnyRole(...)
requirePlatformAdmin()
requireDeveloperOrAdmin()
requireSchoolAdminOrPlatformAdmin(schoolId)
requireTeacherForClassOrAdmin(classId)
requireStudentOrTeacherClassAccess(classId)
```

**Initial route matrix:**

```
/api/me
  any authenticated user

/api/chat/*
/api/chat-sessions/*
  any authenticated user, scoped to own sessions

/api/registry/apps [read]
  authenticated users, filtered by role/scope as needed

/api/registry/apps [submit]
/api/developer/*
  developer or platform_admin

/api/review/*
  platform_admin

/api/schools/:schoolId/allowlist/*
  school_admin for school or platform_admin

/api/classes/:classId/allowlist/*
  teacher for class or platform_admin
```

**Security rule:**
- Frontend hiding is helpful UX.
- Backend route enforcement is the real security boundary.

---

### US-17.4: Frontend surfaces reflect effective role and scope

**As a** signed-in user,  
**I want** TutorMeAI to show only the controls I am actually allowed to use,  
**so that** the product feels coherent and does not advertise unavailable features.

#### Acceptance Criteria

- `GET /api/me` exposes enough role information for frontend gating.
- Students do not see admin or teacher governance controls.
- School admins see only school-scoped controls for schools they belong to.
- Teachers see only class-scoped controls for classes they teach.
- Developers see only developer-owned portal functions.
- Platform admins can reach platform-wide review and audit surfaces.

#### Testing

- Frontend tests verify role-aware navigation and feature visibility.
- Manual test verifies each role sees an appropriate Settings -> ChatBridge experience.

#### Spec

**Frontend surfaces should be scoped as follows:**

```text
platform_admin
  global registry review
  global audit and policy

school_admin
  school app approval
  school membership/class management

teacher
  class selector limited to taught classes
  class activation controls

student
  runtime-only app shelf and conversation

developer
  owned apps and review feedback
```

---

### US-17.5: Role and membership administration is auditable

**As a** platform admin,  
**I want** role assignment and school/class membership changes to be explicit and auditable,  
**so that** access changes are explainable and recoverable.

#### Acceptance Criteria

- Role assignments and revocations are durable.
- School membership additions and removals are durable.
- Class membership additions and removals are durable.
- Sensitive authorization mutations are audit-trailed.
- The platform can answer who granted a role or class access and when.

#### Testing

- Integration tests verify role assignment writes durable records.
- Manual audit queries confirm role and class membership changes can be reconstructed.

#### Spec

**Recommended audit coverage:**

```
RoleAssigned
RoleRevoked
SchoolMembershipAdded
SchoolMembershipRemoved
ClassMembershipAdded
ClassMembershipRemoved
```

**Recommended admin-only capabilities:**

```
assign role
revoke role
add user to school
remove user from school
add teacher/student to class
remove teacher/student from class
view current effective roles and memberships
```

## Out of Scope

- district hierarchy
- district SIS sync
- parent/guardian roles
- public school discovery pages
- enterprise SSO federation
