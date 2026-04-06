# ChatBridge Spec Index

This index tracks the full ChatBridge spec set, grouped by dependency order rather than file creation order.

## Spec Progress Checklist

- [x] `01` Registry and manifest contract
- [x] `02` postMessage runtime protocol
- [x] `03` OAuth orchestration design
- [x] `04` approval and governance model
- [x] `05` error recovery and resilience
- [x] `06` developer SDK contract
- [x] `07` request routing and tool injection
- [x] `08` observability and tracing
- [x] `09` auth and access control
- [x] `10` backend-owned generation and streaming
- [x] `11` persistence and app sessions
- [x] `12` teacher and admin surfaces
- [x] `13` real app integrations
- [x] `14` developer registration portal
- [x] `15` rate limiting and abuse controls
- [x] `16` deployment and runtime optimization
- [x] `17` role-based authorization and class membership
- [x] `18` school hierarchy and scoped governance
- [x] `19` entitlement-aware runtime class bootstrap
- [ ] `20` initial message flicker bug (open)

## Implementation Progress Checklist

- [x] `09` Auth gate and backend route protection
- [x] `10` Backend-owned non-streaming web chat
- [x] `10` Backend-owned ChatBridge policy context and invocation audit events
- [x] `10` Streaming backend chat
- [x] `10` Backend-side tool orchestration for app-opening tools
- [ ] `11` Supabase/Postgres-backed control-plane persistence
- [x] `11` Signed-in user chat session persistence through backend + Supabase
- [x] `11` Backend-owned app/session reconciliation
- [x] `11` App-context snapshot persistence
- [x] `09` User profile and role foundation
- [x] `17` Multi-role backend authorization and route enforcement
- [ ] `17` Class membership and role-aware app/session access
- [ ] `17` Role-aware frontend navigation and surfaces
- [x] `18` School hierarchy schema and scoped memberships
- [x] `18` School-level app approval
- [x] `18` Class-level activation constrained by school approval
- [x] `18` School-admin and teacher scoped settings workspace
- [ ] `18` Student shelf and tool exposure derived from school + class scope
- [ ] `19` Entitlement-aware runtime class bootstrap for missing or invalid `activeClassId`
- [x] `12` Dedicated teacher/admin surfaces
- [x] `03` OAuth connect/status/revoke foundation
- [ ] `13` Additional real apps beyond Weather
- [x] `14` Developer self-serve manifest submission and owned apps
- [x] `14` Developer review feedback loop
- [x] `14` Version-safe developer resubmissions
- [ ] `14` Developer-facing registration portal
- [x] `15` Rate limiting and abuse controls
- [x] `16` Web-only build path
- [ ] `16` Deployment/runtime optimization follow-up

## Dependency Order

### Foundation

- [01-registry-and-manifest.md](/Users/fsyed/Documents/ChatBridge/specs/01-registry-and-manifest.md)
  - Defines the manifest contract, permissions, auth metadata, and app registration shape.
- [02-postmessage-protocol.md](/Users/fsyed/Documents/ChatBridge/specs/02-postmessage-protocol.md)
  - Defines the host/app runtime protocol inside the iframe boundary.
- [04-approval-and-governance.md](/Users/fsyed/Documents/ChatBridge/specs/04-approval-and-governance.md)
  - Defines platform approval, school approval, and class activation.
- [05-error-recovery-and-resilience.md](/Users/fsyed/Documents/ChatBridge/specs/05-error-recovery-and-resilience.md)
  - Defines timeouts, recovery, and degraded behavior.
- [06-developer-sdk.md](/Users/fsyed/Documents/ChatBridge/specs/06-developer-sdk.md)
  - Defines the developer-facing runtime contract.
- [08-observability-and-tracing.md](/Users/fsyed/Documents/ChatBridge/specs/08-observability-and-tracing.md)
  - Defines trace, audit, and event expectations.
- [09-auth-and-access-control.md](/Users/fsyed/Documents/ChatBridge/specs/09-auth-and-access-control.md)
  - Defines who can access the product and which roles can perform privileged actions.

### Runtime and Orchestration

- [07-request-routing-and-tool-injection.md](/Users/fsyed/Documents/ChatBridge/specs/07-request-routing-and-tool-injection.md)
  - Depends on the app/tool and governance model.
- [10-backend-owned-generation-and-streaming.md](/Users/fsyed/Documents/ChatBridge/specs/10-backend-owned-generation-and-streaming.md)
  - Moves generation, later streaming, and later tool orchestration behind `bridge-backend`.
- [11-persistence-and-app-sessions.md](/Users/fsyed/Documents/ChatBridge/specs/11-persistence-and-app-sessions.md)
  - Moves registry, allowlists, audit, and app session state to durable backend storage.
- [15-rate-limiting-and-abuse-controls.md](/Users/fsyed/Documents/ChatBridge/specs/15-rate-limiting-and-abuse-controls.md)
  - Protects the backend generation and app runtime surface from abuse.
- [17-role-based-authorization-and-class-membership.md](/Users/fsyed/Documents/ChatBridge/specs/17-role-based-authorization-and-class-membership.md)
  - Defines multi-role authorization, school/class membership, and route enforcement beyond basic auth.
- [18-school-hierarchy-and-scoped-governance.md](/Users/fsyed/Documents/ChatBridge/specs/18-school-hierarchy-and-scoped-governance.md)
  - Defines the school boundary, school-admin scope, teacher class activation, and student app visibility chain.
- [19-entitlement-aware-runtime-class-bootstrap.md](/Users/fsyed/Documents/ChatBridge/specs/19-entitlement-aware-runtime-class-bootstrap.md)
  - Defines how sessions recover a valid runtime class from real entitlement when persisted class state is missing or invalid.

### Governance, Product Surfaces, and Ecosystem

- [12-teacher-admin-surfaces.md](/Users/fsyed/Documents/ChatBridge/specs/12-teacher-admin-surfaces.md)
  - Defines the real control-plane UI for platform admins, school admins, and teachers beyond the session-local internal panel.
- [14-developer-registration-portal.md](/Users/fsyed/Documents/ChatBridge/specs/14-developer-registration-portal.md)
  - Defines developer self-serve onboarding and versioned submissions into the global platform registry.

### External Integrations

- [03-oauth-orchestration.md](/Users/fsyed/Documents/ChatBridge/specs/03-oauth-orchestration.md)
  - Depends on manifest auth metadata and backend trust boundaries.
- [13-real-app-integrations.md](/Users/fsyed/Documents/ChatBridge/specs/13-real-app-integrations.md)
  - Defines the rollout order for Weather, Story Builder, Chess, and Google Classroom.

### Platform Optimization

- [16-deployment-and-runtime-optimization.md](/Users/fsyed/Documents/ChatBridge/specs/16-deployment-and-runtime-optimization.md)
  - Defines deployment/build/runtime optimization requirements without changing trust boundaries.

### Known Bugs

- [20-initial-message-flicker-bug.md](/Users/fsyed/Documents/ChatBridge/specs/20-initial-message-flicker-bug.md)
  - First message in a new session flickers and disappears for Platform Admin and Teacher roles. Race condition between session creation, optimistic cache updates, and backend persistence.

## Recommended Build Sequence

1. Auth and access control
2. Durable persistence and app sessions
3. Role-based authorization and class membership
4. School hierarchy and scoped governance
5. Entitlement-aware runtime class bootstrap
6. Backend-owned generation
7. Rate limiting and abuse controls
8. Teacher/admin surfaces
9. OAuth orchestration
10. Real app integrations beyond Weather
11. Developer registration portal
12. Deployment/runtime optimization

## Notes

- Earlier epics `01` through `08` define the base Bridge contract.
- Later epics `09` through `18` define the remaining productization and production-readiness work.
- Some implementation slices span multiple specs; for example, Google Classroom depends on `03`, `09`, `10`, `11`, and `13`.
