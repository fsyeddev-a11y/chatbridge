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

## Implementation Progress Checklist

- [x] `09` Auth gate and backend route protection
- [x] `10` Backend-owned non-streaming web chat
- [x] `10` Backend-owned ChatBridge policy context and invocation audit events
- [ ] `10` Streaming backend chat
- [x] `10` Backend-side tool orchestration for app-opening tools
- [ ] `11` Supabase/Postgres-backed control-plane persistence
- [x] `11` Backend-owned app/session reconciliation
- [x] `11` App-context snapshot persistence
- [x] `12` Dedicated teacher/admin surfaces
- [ ] `13` Additional real apps beyond Weather
- [x] `14` Developer self-serve manifest submission and owned apps
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
  - Defines platform approval and class allowlisting.
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

### Governance, Product Surfaces, and Ecosystem

- [12-teacher-admin-surfaces.md](/Users/fsyed/Documents/ChatBridge/specs/12-teacher-admin-surfaces.md)
  - Defines the real control-plane UI beyond the session-local internal panel.
- [14-developer-registration-portal.md](/Users/fsyed/Documents/ChatBridge/specs/14-developer-registration-portal.md)
  - Defines developer self-serve onboarding and versioned submissions.

### External Integrations

- [03-oauth-orchestration.md](/Users/fsyed/Documents/ChatBridge/specs/03-oauth-orchestration.md)
  - Depends on manifest auth metadata and backend trust boundaries.
- [13-real-app-integrations.md](/Users/fsyed/Documents/ChatBridge/specs/13-real-app-integrations.md)
  - Defines the rollout order for Weather, Story Builder, Chess, and Google Classroom.

### Platform Optimization

- [16-deployment-and-runtime-optimization.md](/Users/fsyed/Documents/ChatBridge/specs/16-deployment-and-runtime-optimization.md)
  - Defines deployment/build/runtime optimization requirements without changing trust boundaries.

## Recommended Build Sequence

1. Auth and access control
2. Backend-owned generation
3. Durable persistence and app sessions
4. Rate limiting and abuse controls
5. Teacher/admin surfaces
6. OAuth orchestration
7. Real app integrations beyond Weather
8. Developer registration portal
9. Deployment/runtime optimization

## Notes

- Earlier epics `01` through `08` define the base Bridge contract.
- Later epics `09` through `16` define the remaining productization and production-readiness work.
- Some implementation slices span multiple specs; for example, Google Classroom depends on `03`, `09`, `10`, `11`, and `13`.
