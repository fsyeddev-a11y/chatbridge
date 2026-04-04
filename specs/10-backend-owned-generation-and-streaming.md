# Epic 10: Backend-Owned Generation & Streaming

## Dependencies

- Depends on: `09-auth-and-access-control.md`
- Informs: `11-persistence-and-app-sessions.md`, `13-real-app-integrations.md`, `15-rate-limiting-and-abuse-controls.md`

## Status

- Implemented now:
  - authenticated backend-owned non-streaming chat generation for deployed web
  - backend-held OpenAI key for core chat
  - no browser-side provider setup required for core web chat
- Not implemented yet:
  - streaming responses
  - backend-side ChatBridge tool orchestration
  - backend generation event emission parity with frontend tracing

## Context

TutorMeAI can no longer depend on browser-side provider configuration for core chat. The platform already has a backend-owned chat generation path for web deployment, but it is currently request/response only and does not yet own full tool orchestration. This epic formalizes the long-term contract for backend-owned model access, streaming, and later backend-side tool execution.

---

## User Stories

### US-10.1: Chat generation is always backend-owned in deployed web environments

**As a** platform owner,  
**I want** deployed TutorMeAI web chats to go through `bridge-backend`,  
**so that** model keys, policy, and rate limits remain server-controlled.

#### Acceptance Criteria

- Web deployment does not require local provider configuration to send a message.
- Chat requests are sent from the frontend to `bridge-backend`.
- `bridge-backend` holds the LLM API key in server environment variables only.
- The frontend displays the backend-selected model label without requiring the user to choose a provider.

#### Testing

- Unit tests verify the backend chat route returns a model response when authorized.
- Manual network inspection confirms chat requests hit `bridge-backend`, not the provider directly.
- Manual UI test confirms the core chat flow works with no browser-side provider setup.

#### Spec

**Current MVP backend path:**

```
frontend prompt context
  -> POST /api/chat/generate
  -> bridge-backend
  -> OpenAI chat completion
  -> assistant message update
```

**Design rule:**
- Browser-side provider setup is not the source of truth for deployed TutorMeAI web chat.
- The backend, not the browser, owns provider choice, policy, and spend.

---

### US-10.2: Backend generation supports streaming responses

**As a** student,  
**I want** TutorMeAI responses to stream progressively,  
**so that** the product feels fast and conversational rather than blocking on full completion.

#### Acceptance Criteria

- The backend exposes a streaming generation endpoint.
- The frontend can progressively update the assistant message as tokens arrive.
- The stream can be cancelled from the frontend.
- Errors mid-stream are surfaced gracefully and leave the message in a recoverable state.

#### Testing

- Integration tests verify the frontend can consume a streamed backend response.
- Manual test confirms stop/cancel works while the stream is active.
- Manual test confirms partial output is preserved correctly if the stream fails.

#### Spec

**Target streaming contract:**

```
POST /api/chat/stream
  request:
    messages[]
    sessionId
    traceId

  response:
    SSE or chunked stream of:
      - started
      - delta text
      - tool events (later)
      - completed
      - error
```

**Design rule:**
- Streaming state is an execution detail.
- Final persisted assistant content remains platform-owned.

**Open implementation choice:**
- SSE is preferred for MVP unless backend infrastructure forces a chunked fetch stream.

---

### US-10.3: Backend generation becomes the enforcement point for tool use

**As a** platform engineer,  
**I want** the backend generation layer to eventually own ChatBridge tool routing,  
**so that** app/tool invocation policy is enforced server-side instead of relying on the browser model path.

#### Acceptance Criteria

- The long-term architecture supports backend-side tool assembly.
- ChatBridge tool availability can be determined server-side from session/class/app data.
- Tool invocation policy can be enforced without trusting the browser.
- The backend route can later emit tool-invocation and tool-result events as part of generation.

#### Testing

- Future integration tests should verify approved tools are exposed only for allowed classes.
- Future security tests should verify the browser cannot force execution of unavailable tools.

#### Spec

**Future backend flow:**

```
frontend sends conversation + sessionId
  -> bridge-backend loads:
       session state
       class allowlist
       app registry
       tool definitions
  -> bridge-backend calls model
  -> bridge-backend executes/mediates tool calls
  -> frontend receives streamed result
```

**Dependencies for full tool orchestration:**
- durable session storage from `11-persistence-and-app-sessions.md`
- class approval data from `04-approval-and-governance.md`
- tool routing model from `07-request-routing-and-tool-injection.md`
- app runtime lifecycle from `02-postmessage-protocol.md`

---

### US-10.4: Backend generation emits structured operational events

**As a** platform engineer,  
**I want** backend generation to emit generation and model lifecycle events,  
**so that** chat reliability can be observed independently of frontend behavior.

#### Acceptance Criteria

- Backend generation emits at least:
  - `ModelInvocationStarted`
  - `ModelInvocationCompleted`
  - `ModelInvocationFailed`
- Events carry `traceId`, `sessionId`, model name, and result category.
- Events do not log raw secrets or prompt content unnecessarily.

#### Testing

- Unit tests verify event emission hooks are called.
- Manual inspection verifies provider failures are visible in backend logs.

## Out of Scope

- user-managed provider keys in the browser
- direct browser-to-provider model traffic
- multi-provider routing UI in the deployed student experience
