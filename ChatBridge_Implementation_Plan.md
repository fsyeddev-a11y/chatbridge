# ChatBridge Implementation Plan

## Current Status

### Done
- [x] Supabase-gated access for internal testers
- [x] No public sign-up
- [x] Backend-protected ChatBridge API routes
- [x] Backend-owned chat generation path for web
- [x] Backend-owned streaming chat path
- [x] Secure iframe runtime with origin checks and validated `postMessage`
- [x] ChatBridge manifest registration API
- [x] Platform review state updates
- [x] School-level app approval routes
- [x] Teacher/class allowlist mutation routes
- [x] Real external Weather app integration
- [x] Backend audit event ingestion
- [x] Session runtime surfaces limited to ChatBridge shelf and active app panel
- [x] Dedicated `Settings -> ChatBridge` workspace with role-scoped sections

### In Progress
- [ ] Shift more product state from frontend session state to backend-owned persistence
- [ ] Runtime class validation for backend chat/session access
- [ ] Teacher-only class activation flow in `Settings -> ChatBridge`

### Not Started
- [ ] Remove demo bootstrap defaults (`demo-school`, `demo-class`) from runtime authorization
- [ ] Backend-side ChatBridge tool orchestration with strict entitlement validation
- [ ] Complete durable Supabase/Postgres persistence rollout
- [ ] OAuth orchestration
- [ ] Google Classroom integration
- [ ] Role-aware navigation and route gating for `Settings -> ChatBridge`
- [ ] Developer registration portal
- [ ] Production observability dashboards

## Priority Order

### Tier 0: Non-Negotiable Foundations
These unlock the rest of the platform.

1. Authenticated access to the product
- [x] Supabase sign-in
- [x] No public sign-up
- [x] Backend route protection

2. Backend-owned model access
- [x] LLM API key only on `bridge-backend`
- [x] Frontend no longer requires provider setup for core chat
- [x] Authenticated backend chat generation route

3. Secure iframe boundary
- [x] Sandboxed iframe loading
- [x] Strict allowed-origin checks
- [x] `postMessage` validation
- [x] No transcript access by apps

4. Canonical Bridge contract
- [x] Manifest schema
- [x] Host/app message schema
- [x] State update validation
- [x] Completion event validation

### Tier 1: Core Platform Runtime
These make ChatBridge a functioning platform rather than a frontend demo.

5. App registry
- [x] Register app manifests
- [x] Fetch registry entries
- [x] Review state tracking
- [ ] Manifest version update flow

6. Governance model
- [x] Platform approval
- [x] School approval
- [x] Teacher/class allowlist mutations
- [x] Class-scoped app exposure for validated class reads
- [ ] Runtime class entitlement validation for chat/session state
- [ ] Remove demo fallback class selection from runtime

7. App lifecycle runtime
- [x] `INIT`
- [x] `APP_READY`
- [x] `PING`
- [x] `HEARTBEAT`
- [x] `STATE_UPDATE`
- [x] `APP_COMPLETE`
- [x] `TERMINATE`

8. Failure handling
- [x] Startup timeout
- [x] Heartbeat timeout
- [x] Invalid payload rejection
- [x] Graceful continue-without-app behavior

9. Backend-owned chat integration
- [x] Backend chat endpoint
- [x] Web app uses backend generation path
- [x] Provider setup removed from core chat flow
- [x] Streaming responses
- [x] Backend-side tool orchestration
- [ ] Backend rejects non-entitled class context during chat/tool orchestration

### Tier 2: State, Storage, and Audit
These are the next major production-readiness block.

10. Durable backend persistence
- [ ] Remove file-backed store as the default runtime path
- [x] Use Supabase/Postgres for registry
- [x] Use Supabase/Postgres for allowlists
- [x] Use Supabase/Postgres for audit events
- [x] Use Supabase/Postgres for app sessions
- [x] Use Supabase/Postgres for app context
- [ ] Fix remaining Supabase parity gaps in role-scoped ChatBridge UI data

11. App/session persistence
- [ ] Active app state survives reloads
- [ ] App context is backend-owned
- [ ] Session/app reconciliation on reconnect

12. Observability and audit trail
- [x] Frontend audit events
- [x] Backend audit ingestion
- [ ] Backend generation event logging
- [ ] App lifecycle viewer/dashboard
- [ ] Auth failure visibility
- [ ] Trace search and filtering

### Tier 3: Real Integration Requirements
These prove the platform against real partner-style apps.

13. Real external app integrations
- [x] Weather
- [ ] AI Story Builder
- [ ] Chess
- [ ] Google Classroom

14. OAuth orchestration
- [ ] Provider connect flow
- [ ] Callback handling
- [ ] Token refresh
- [ ] Server-only token storage
- [ ] No token exposure to iframe

15. Google Classroom integration
- [ ] Read-only v1
- [ ] Student/class context fetch
- [ ] Backend-mediated API access

### Tier 4: UX and Productization
Important, but dependent on the backend and persistence layers.

16. Teacher/admin product surfaces
- [x] Real admin review UI in `Settings -> ChatBridge`
- [x] School-admin school approval UI in `Settings -> ChatBridge`
- [x] Teacher allowlist UI outside the session page
- [ ] Route-level gating so students cannot access `Settings -> ChatBridge`
- [ ] Fix teacher visibility of school-approved app state
- [ ] App status visibility

17. Developer registration experience
- [ ] Developer auth
- [ ] Manifest submission UI
- [ ] Docs and SDK-backed onboarding
- [ ] Approval feedback loop
- [ ] Version resubmission flow

18. Better chat UX
- [ ] Streaming backend responses
- [ ] Better loading states
- [ ] More polished app recovery/open/close flow

### Tier 5: Scale and Hardening
Important once the core platform path is stable.

19. Rate limiting and abuse controls
- [ ] Per user
- [ ] Per session
- [ ] Per org/class

20. Stronger schema and policy enforcement
- [ ] Richer manifest validation
- [ ] Stricter state payload constraints
- [ ] Better LLM-safe summary controls

21. Deployment and runtime optimization
- [x] Web-only `chatbox-web` build path
- [ ] Service-specific deploy triggers
- [ ] Smaller frontend bundle
- [ ] Faster install/build strategy

## Recommended Next Sequence

1. Enforce runtime class entitlement validation for bridge state and backend chat/tool access
2. Remove demo bootstrap defaults from runtime authorization and class selection
3. Fix teacher role flow in `Settings -> ChatBridge` and hide ChatBridge settings from students
4. Close Supabase parity gaps for role-scoped ChatBridge workspace data
5. OAuth orchestration
6. Google Classroom integration
7. Developer registration portal
8. Production observability dashboards

## Immediate Next Slice

### Recommendation
- [ ] Enforce backend validation of `activeClassId` for bridge-state persistence and backend chat/tool orchestration

### Why This Next
- It closes the largest remaining authorization gap in the role model
- It makes class-scoped shelf and tool exposure defensible for teachers and students
- It removes reliance on the demo fallback path that still leaks into runtime behavior
- It gives the frontend a trustworthy backend contract before more UI work lands
