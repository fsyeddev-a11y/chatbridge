# Epic 15: Rate Limiting & Abuse Controls

## Dependencies

- Depends on: `09-auth-and-access-control.md`, `10-backend-owned-generation-and-streaming.md`, `11-persistence-and-app-sessions.md`

## Status

- Implemented now:
  - authenticated backend boundary for core ChatBridge API routes
- Not implemented yet:
  - explicit generation rate limits
  - abuse scoring or anomaly detection
  - app/tool-specific throttles

## Context

Once TutorMeAI uses backend-owned model access, it becomes an attractive abuse target. Even with auth in place, the platform needs explicit rate limiting, denial responses, and logging to avoid turning the backend into an unrestricted chat proxy or a source of runaway cost.

---

## User Stories

### US-15.1: The backend rate-limits chat generation

**As a** platform owner,  
**I want** backend generation to be rate-limited,  
**so that** misuse does not create cost spikes or service instability.

#### Acceptance Criteria

- Chat generation has per-user limits.
- The system can later support per-class or per-org limits.
- Rate-limited responses return a clear, non-ambiguous error.
- Rate-limit events are logged for observability.

#### Testing

- Unit/integration tests verify requests above the threshold are rejected.
- Manual test verifies normal traffic is unaffected below the threshold.

#### Spec

**Initial limit dimensions:**

```
per-user
per-session
per-IP (defense in depth)
later: per-class / per-org
```

---

### US-15.2: Protected routes reject malformed or suspicious requests predictably

**As a** platform engineer,  
**I want** Bridge routes to reject malformed, oversized, or policy-invalid requests early,  
**so that** abuse does not reach expensive downstream systems.

#### Acceptance Criteria

- Payload validation happens before model/provider invocation.
- Rejected requests produce deterministic error categories.
- Oversized or invalid requests are auditable.

#### Testing

- Validation tests verify malformed requests fail before provider calls.
- Security tests verify repeated bad requests are observable.

#### Spec

**Early rejection categories:**

```
unauthenticated
unauthorized
malformed
oversized
rate_limited
policy_denied
```

---

### US-15.3: Abuse controls extend to app and tool usage

**As a** platform owner,  
**I want** app/tool usage to be rate-limited and observable too,  
**so that** one app cannot be abused to degrade the whole platform.

#### Acceptance Criteria

- Tool invocation counts are observable per user/session/app.
- The backend can later enforce per-app or per-tool rate limits.
- Abuse controls can distinguish normal tutoring usage from automation or flooding.

#### Testing

- Future integration tests verify repeated tool abuse is denied predictably.

## Out of Scope

- full fraud detection platform
- CAPTCHA-style end-user defenses
- cross-product enterprise quota management
