# Epic 14: Developer Registration Portal

## Dependencies

- Depends on: `01-registry-and-manifest.md`, `04-approval-and-governance.md`, `09-auth-and-access-control.md`, `12-teacher-admin-surfaces.md`
- Informs: `06-developer-sdk.md`

## Status

- Implemented now:
  - backend manifest registration API
  - internal control-plane registration action
  - developer-owned app dashboard
  - owner-scoped review feedback and review-history visibility
- Not implemented yet:
  - developer-facing auth
  - version-safe resubmission flow
  - explicit approved-vs-pending version coexistence

## Context

ChatBridge already has internal manifest registration APIs, but not a real developer-facing registration product. This epic defines the self-serve developer onboarding experience needed to move from internal control-plane registration to external app ecosystem growth.

---

## User Stories

### US-14.1: Developers can authenticate and submit manifests

**As a** third-party developer,  
**I want** to authenticate and submit a manifest through a developer surface,  
**so that** I can onboard an app without manual database or control-plane changes.

#### Acceptance Criteria

- Developer users can sign in separately from teacher/student flows.
- Developers can submit a new manifest through a form or validated upload flow.
- Submitted manifests enter `pending` review state automatically.

#### Testing

- Integration tests verify only developer/admin roles can submit manifests.
- Validation tests verify malformed manifests are rejected with clear errors.

#### Spec

**Submission flow:**

```
developer signs in
  -> opens developer portal
  -> submits manifest form or validated JSON upload
  -> backend validates schema and ownership
  -> app enters pending review
  -> developer receives submission identifier and initial status
```

---

### US-14.2: Developers can view owned apps and review feedback

**As a** developer,  
**I want** to see the current state of my submitted apps,  
**so that** I know whether they are pending, approved, rejected, or suspended.

#### Acceptance Criteria

- Developers can view only apps they own.
- Developers can see current review state and high-level feedback.
- Developers can distinguish between new submission, approved version, and suspended app states.

#### Testing

- Integration tests verify developers cannot read apps they do not own.
- Manual test verifies review-state changes appear in the developer view.

#### Spec

**Developer dashboard views:**

```
owned apps
current review state
active approved version
pending submitted version
review feedback summary
```

---

### US-14.3: Developers can resubmit or version manifests safely

**As a** developer,  
**I want** to submit updated app versions without corrupting active approved versions,  
**so that** iteration is possible without breaking classrooms.

#### Acceptance Criteria

- App versions are tracked explicitly.
- Review actions are version-aware.
- A new submission does not silently overwrite the currently approved runtime contract.

#### Testing

- Versioning tests verify approved and pending versions can coexist safely.
- Manual test verifies resubmitting a manifest does not erase prior review history.

#### Spec

**Versioning rules:**

```
approved version remains active until replacement is approved
pending version never silently replaces active version
review actions are version-specific
suspension history remains auditable across versions
```

## Out of Scope

- developer billing and monetization
- public app ranking or discovery
- automated legal/compliance review
