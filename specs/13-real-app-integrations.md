# Epic 13: Real App Integrations

## Dependencies

- Depends on: `02-postmessage-protocol.md`, `05-error-recovery-and-resilience.md`, `10-backend-owned-generation-and-streaming.md`, `11-persistence-and-app-sessions.md`
- Informs: `03-oauth-orchestration.md`, `14-developer-registration-portal.md`

## Status

- Implemented now:
  - real external Weather integration
- Not implemented yet:
  - Story Builder
  - Chess
  - Google Classroom

## Context

Mock apps proved the Bridge contract, and Weather already proves the first real external iframe path. The next task is sequencing real integrations in a way that validates the platform progressively instead of jumping straight into the most complex case.

---

## User Stories

### US-13.1: Weather remains the reference “simple real app”

**As a** platform engineer,  
**I want** Weather to remain the simplest real integration reference,  
**so that** onboarding and regression testing have a lightweight baseline app.

#### Acceptance Criteria

- Weather uses a real hosted origin.
- Weather supports `INIT`, `APP_READY`, `STATE_UPDATE`, `APP_COMPLETE`, and `HEARTBEAT`.
- Weather works end-to-end through the current deployed Bridge contract.

#### Testing

- Manual regression test on deployed environment.
- Contract tests for message schema and lifecycle.

#### Spec

**Weather baseline responsibilities:**

```
lookup weather data from external public source
receive INIT
send APP_READY
send STATE_UPDATE with llm-safe summary fields
respond to PING with HEARTBEAT
send APP_COMPLETE on finalization
```

---

### US-13.2: AI Story Builder becomes the next real stateful app

**As a** product team,  
**I want** Story Builder to be the next real app after Weather,  
**so that** we validate richer app state before tackling Chess.

#### Acceptance Criteria

- Story Builder is externally hosted and embedded via iframe.
- It supports structured draft/state updates and completion events.
- TutorMeAI can summarize story progress using Bridge-authored summaries.

#### Testing

- Manual test verifies stateful draft progression across multiple app actions.
- Recovery test verifies last safe state survives reload or reconnect once persistence is in place.

#### Spec

**Story Builder is the first app that must prove:**

```
multi-step state progression
platform-authored summary evolution
resume after reload
completion without losing prior draft context
```

---

### US-13.3: Chess is integrated after the Bridge is proven on simpler apps

**As a** platform engineer,  
**I want** Chess to come after Weather and Story Builder,  
**so that** the most complex app validates a more mature Bridge runtime.

#### Acceptance Criteria

- Chess supports long-lived board state.
- TutorMeAI can reason over Bridge-authored board summaries during play.
- Chess validates the long-lived session, coaching, and recovery model.

#### Testing

- Multi-turn manual playthrough.
- Recovery tests after refresh and timeout.
- Failure tests for invalid state and missed heartbeat.

#### Spec

**Chess validates:**

```
long-lived app session persistence
Bridge-authored game state summaries
mid-game tutoring questions
graceful recovery after timeout or reconnect
```

---

### US-13.4: Google Classroom is only integrated after OAuth is ready

**As a** platform owner,  
**I want** Google Classroom to be gated on OAuth completion,  
**so that** we do not build an incomplete or unsafe classroom integration.

#### Acceptance Criteria

- Google Classroom is read-only in v1.
- No iframe sees Google tokens.
- API access is mediated by the backend.

#### Testing

- OAuth callback and refresh tests.
- Manual test verifies student coursework can be retrieved without exposing tokens.

#### Spec

**Google Classroom v1 constraints:**

```
read-only only
backend-mediated OAuth and API calls
no provider tokens in iframe or browser-accessible app payloads
minimal classroom context exposed to the model
```

## Out of Scope

- consumer-style app marketplace breadth
- write-capable Google Classroom actions in v1
- simultaneous rollout of all apps at once
