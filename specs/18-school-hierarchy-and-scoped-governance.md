# Epic 18: School Hierarchy & Scoped Governance

## Dependencies

- Depends on: `04-approval-and-governance.md`, `09-auth-and-access-control.md`, `17-role-based-authorization-and-class-membership.md`
- Informs: `12-teacher-admin-surfaces.md`, `13-real-app-integrations.md`, `14-developer-registration-portal.md`

## Status

- Implemented now:
  - a single demo class flow
  - platform approval state
  - class-level allowlist mechanics
- Not implemented yet:
  - real `schools`
  - `school_admin` school-scoped governance
  - school-level app approval
  - teacher class activation constrained by school approval
  - student app exposure derived from school and class membership

## Context

TutorMeAI needs a real school-scoped operating model before the role system can be considered complete. Right now, ChatBridge has platform review, developer submission, and a demo-class allowlist, but it does not yet model the school boundary that sits between platform governance and classroom use.

This epic defines the tenant chain:

- developer submits globally
- platform admin approves globally
- school admin enables for a school
- teacher activates for a class they teach
- students in that class can use it

There is no district layer in this model. `school` is the tenancy boundary.

---

## User Stories

### US-18.1: Classes belong to schools and inherit school policy boundaries

**As a** platform architect,  
**I want** every class to belong to exactly one school,  
**so that** school policy and class policy can be enforced together.

#### Acceptance Criteria

- Every class has a required `schoolId`.
- A school can contain many classes.
- A teacher may teach many classes within a school.
- A student may be enrolled in many classes within a school.
- Membership rules prevent users from being attached to classes outside the school they belong to.

#### Testing

- Schema tests verify `classes.school_id` is required and references `schools`.
- Integration tests verify invalid cross-school membership inserts are rejected.
- Manual test confirms one teacher can be attached to multiple classes in one school.

#### Spec

**Core tenancy model:**

```text
schools
  id
  name

classes
  id
  school_id
  name

school_memberships
  school_id
  user_id
  role           // school_admin | teacher | student

class_memberships
  class_id
  user_id
  role           // teacher | student
```

**Integrity rule:**
- `class_memberships` must be consistent with the parent class’s `school_id`.

---

### US-18.2: School admins approve platform-approved apps for their school

**As a** school admin,  
**I want** to enable approved apps for my school,  
**so that** only apps my school accepts can reach teachers or students.

#### Acceptance Criteria

- Only `platform_admin` can approve apps globally.
- Only `school_admin` for a school, or `platform_admin`, can enable an app for that school.
- A school can only enable apps whose active version is platform-approved.
- School approval does not automatically expose an app to every class.
- School approval creates a durable school-level allowlist record.

#### Testing

- Integration tests verify a non-school-admin user receives `403` when mutating another school’s allowlist.
- Integration tests verify a suspended or non-approved app cannot be school-enabled.
- Manual test confirms a school admin can enable an app for one school without affecting another.

#### Spec

**School allowlist model:**

```text
school_app_allowlists
  school_id
  app_id
  enabled_by
  enabled_at
  disabled_at
```

**Policy rule:**
- School approval is the middle gate between platform approval and class activation.

---

### US-18.3: Teachers activate school-approved apps for classes they teach

**As a** teacher,  
**I want** to enable a school-approved app for one class I teach without enabling it for all my classes,  
**so that** class usage can match curriculum needs.

#### Acceptance Criteria

- A teacher can only manage classes:
  - in their school
  - and that they teach
- A teacher can only class-enable an app if the app is already school-enabled for that class’s school.
- Enabling an app for `Class 303` does not enable it for `Class 101` or `Class 202`.
- Class activation is stored durably and independently for each class.

#### Testing

- Integration tests verify a teacher cannot enable an app for a class they do not teach.
- Integration tests verify a teacher cannot enable an app for a class if the school has not enabled it first.
- Manual test verifies one teacher can enable an app for one of several taught classes without affecting the others.

#### Spec

**Class activation model:**

```text
class_app_allowlists
  class_id
  app_id
  enabled_by
  enabled_at
  disabled_at
```

**Example:**

```text
Teacher: Mr. Smith
Teaches: 101, 202, 303
School enabled: algebra-app
Teacher enables: algebra-app for 303 only

Result:
  303 sees algebra-app
  101 does not
  202 does not
```

---

### US-18.4: Students only see apps that passed all required gates

**As a** student,  
**I want** the app shelf to only show apps my class can actually use,  
**so that** the runtime matches school and teacher policy.

#### Acceptance Criteria

- A student only sees an app if:
  - it is platform-approved
  - it is school-enabled for the student’s school
  - it is class-enabled for one of the student’s classes
- Runtime tool exposure follows the same rule as the shelf.
- Students cannot use prompt tricks or direct calls to reach non-exposed apps.
- If school or class approval is revoked, the app disappears from the shelf and toolset on the next turn.

#### Testing

- Integration tests verify student shelf queries only return apps passing all three gates.
- Integration tests verify backend tool orchestration does not expose apps outside the student’s class scope.
- Manual test verifies a student in one class does not see a class-enabled app from another class.

#### Spec

**Effective availability rule:**

```text
student can use app
  only if
    platform approved
    AND school enabled
    AND class enabled
    AND student enrolled in class
```

---

### US-18.5: Developer submissions stay global instead of school-owned

**As a** platform owner,  
**I want** developer submissions to enter one global registry,  
**so that** app review and versioning are platform-governed rather than fragmented per school.

#### Acceptance Criteria

- Developer submissions are not tied to a school.
- Platform review is global.
- School admins only control adoption of already-reviewed apps.
- Developer ownership never implies access to school governance or student classroom data.

#### Testing

- Integration tests verify developer routes do not require school scope.
- Integration tests verify developer users cannot read school-scoped governance state unless they also hold a school role.
- Manual test confirms one approved app can then be enabled by one school and ignored by another.

#### Spec

**Chain of authority:**

```text
developer
  -> global registry submission
  -> platform review
  -> school enablement
  -> class activation
  -> student use
```

## Out of Scope

- district or district-to-school hierarchy
- billing or commercial school plans
- parent/guardian roles
- automated rostering sync
