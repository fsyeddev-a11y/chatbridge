# Epic 8: Observability & Tracing

## Context

TutorMeAI already has basic application error reporting through Sentry, but ChatBridge introduces new failure modes and trust boundaries that need their own visibility: tool routing mistakes, denied app access, iframe lifecycle failures, OAuth failures, repeated invalid state, and long-lived session drift. Generic frontend crash reporting is not enough to operate this system safely.

This epic defines the observability contract for ChatBridge across frontend, Bridge backend, and third-party app orchestration.

---

## User Stories

### US-8.1: Engineers can trace a student turn through the Bridge

**As a** platform engineer,
**I want** a trace for each student turn from message submission through model generation and app/tool execution,
**so that** I can debug whether a bad outcome came from prompt routing, Bridge policy, app failure, or provider error.

#### Acceptance Criteria

- Every generation turn gets a `traceId`.
- The same `traceId` is attached to message-processing, tool injection, model invocation, tool execution, and completion events.
- ChatBridge-originated tool calls record a `toolCallId` or `correlationId` that links model intent to app activity.
- Frontend and backend logs can be correlated for the same student turn.

#### Spec

**Trace boundaries:**

```
Student message submitted
  → GenerationStarted
  → ToolsetAssembled
  → ModelInvocationStarted
  → ToolInvocationRequested (optional)
  → AppLifecycleEvents / OAuthEvents (optional)
  → ModelInvocationCompleted
  → GenerationCompleted
```

**Trace identifiers:**

```
traceId         string   One per student generation turn
sessionId       string
messageId       string   User message id and/or assistant message id
toolCallId      string   For model tool call correlation
appCorrelationId string  For postMessage TOOL_INVOKE ↔ STATE_UPDATE matching
```

**Design rule:**
- Every async handoff that can fail independently must carry a correlation identifier.

---

### US-8.2: Engineers can audit ChatBridge app lifecycle events

**As a** safety-conscious platform operator,
**I want** a durable log of app activations, state validation failures, and app terminations,
**so that** I can investigate abuse, instability, or policy violations.

#### Acceptance Criteria

- The platform logs app activation, app ready, state update accepted, state update rejected, completion, error, timeout, suspend, and terminate events.
- Each event includes the app version in use.
- Logs distinguish platform actions from app-reported actions.
- Audit logs are queryable by `appId`, `classId`, `studentId`, `reviewState`, and date range.

#### Spec

**Minimum audit event types:**

```
AppActivated
AppInitSent
AppReadyReceived
AppStateAccepted
AppStateRejected
AppCompleted
AppErrored
AppHung
AppTerminated
AppDisabledForClass
AppSuspendedByPlatform
```

**Required event fields:**

```
timestamp
traceId
sessionId
classId
studentId
appId
appVersion
eventType
source            // 'frontend' | 'bridge-backend' | 'app'
summary
metadata
```

**Retention guidance:**
- Operational traces: short retention for debugging
- Governance/audit events: longer retention based on school policy and legal requirements

---

### US-8.3: Engineers can observe OAuth orchestration safely

**As a** platform engineer,
**I want** visibility into OAuth start, callback, success, refresh, revoke, and failure events,
**so that** I can debug login issues without exposing tokens or secrets.

#### Acceptance Criteria

- OAuth events are logged server-side only.
- No access token, refresh token, authorization code, or client secret is ever written to logs.
- Logs show provider, appId, user/session identifiers, and outcome category.
- Token refresh failures are distinguishable from user-cancelled consent and invalid state/CSRF failures.

#### Spec

**OAuth event model:**

```
OAuthStarted
OAuthCallbackReceived
OAuthSucceeded
OAuthFailed
OAuthRefreshStarted
OAuthRefreshSucceeded
OAuthRefreshFailed
OAuthRevoked
```

**Allowed metadata:**
- `provider`
- `appId`
- `sessionId`
- `userId`
- `scopeCount`
- `result`
- `errorCategory`

**Forbidden metadata:**
- access tokens
- refresh tokens
- raw authorization codes
- client secrets
- raw provider responses containing credential material

---

### US-8.4: The team can monitor tool routing quality

**As a** product and platform team,
**I want** to know when the model is invoking the wrong app or missing an obvious app opportunity,
**so that** we can improve tool descriptions, prompts, and approval UX.

#### Acceptance Criteria

- The system records which tools were available on a turn and which were actually invoked.
- Failed or denied ChatBridge tool attempts are counted separately from successful invocations.
- The team can inspect app invocation frequency and timeout/error rates by app.
- Observability supports later evals of routing quality.

#### Spec

**Routing metrics:**

```
chatbridge_tool_available_count
chatbridge_tool_invocation_count
chatbridge_tool_timeout_count
chatbridge_tool_denied_count
chatbridge_tool_error_count
chatbridge_app_activation_count
chatbridge_app_completion_count
```

**Per-event dimensions:**
- `appId`
- `toolName`
- `classId`
- `model`
- `provider`
- `result`

**Evaluation readiness:**
- Store enough metadata to later label turns as:
  - correct tool use
  - unnecessary tool use
  - missed tool opportunity
  - denied by policy

---

### US-8.5: The platform has explicit support for LLM traces and eval tooling

**As a** platform engineer,
**I want** the Bridge observability model to support future LLM tracing tools such as LangSmith without making them a hard dependency today,
**so that** we can start simple and add deeper tracing when the system matures.

#### Acceptance Criteria

- The design names a provider-agnostic tracing interface rather than binding the platform to one vendor.
- Sentry remains the error-monitoring layer for crashes and exceptions.
- Structured generation/tool events can be exported later to LangSmith, OpenTelemetry, or another tracing backend.
- The system can operate without LangSmith in MVP.

#### Spec

**MVP observability stack:**
- Frontend/backend exceptions: Sentry
- Structured ChatBridge events: application logs plus database-backed audit events where needed
- Metrics: host platform telemetry or lightweight counters

**Post-MVP tracing adapters:**

```
TracingAdapter {
  onGenerationStarted(event)
  onToolsetAssembled(event)
  onToolInvoked(event)
  onOAuthEvent(event)
  onAppLifecycleEvent(event)
  onGenerationCompleted(event)
}
```

**Vendor guidance:**
- LangSmith is a valid future adapter for model/tool traces
- OpenTelemetry is a valid future adapter for end-to-end service traces
- Sentry should continue handling exception/error reporting

---

### US-8.6: Privacy and K-12 constraints apply to observability data too

**As a** school-trusted platform,
**I want** telemetry and logs to respect the same data minimization rules as runtime context injection,
**so that** observability does not become a backdoor for storing sensitive student data.

#### Acceptance Criteria

- Student freeform message text is excluded from default operational logs.
- If message text is ever sampled for debugging, it must be explicitly redacted or protected behind elevated access controls.
- PII, auth credentials, and raw third-party payloads are excluded from standard traces.
- Log retention and export policies are documented.

#### Spec

**Default log policy:**
- Log identifiers and categorical outcomes by default
- Do not log raw prompts, raw app payloads, or credential-bearing material
- Redact or hash values where identity is not required for operational debugging

**Sensitive fields never logged:**
- access tokens
- refresh tokens
- authorization codes
- student email addresses
- student IDs
- raw grades
- raw classroom submissions
- raw iframe payloads unless explicitly scrubbed for incident response

**Access control guidance:**
- Operational dashboards use redacted event data
- Detailed audit access is restricted to authorized platform operators
- School-facing reporting should expose policy outcomes, not raw telemetry internals
