# Epic 7: Request Routing & Tool Injection

## Context

When a student types into TutorMeAI, the platform has to decide whether the input should be handled as plain conversation, answered with first-party tools, or routed into a double-approved ChatBridge app. In the current implementation, that decision happens inside the model call pipeline, but the behavior is not yet documented as a formal system contract.

This epic defines the end-to-end routing path from student input to model response, including where tool lists are injected, what the model is allowed to see, and how ChatBridge app tools participate without taking control of the chat.

---

## User Stories

### US-7.1: Student message enters the generation pipeline predictably

**As a** platform engineer,
**I want** every new student message to follow a single, documented pipeline,
**so that** routing, persistence, and observability all happen at the right boundary.

#### Acceptance Criteria

- A newly submitted student message is persisted to session history before model generation begins.
- The platform creates a placeholder assistant message before streaming starts.
- Generation reads from the current session state, not from transient UI-only state.
- The pipeline is documented from input box to model call boundary.

#### Spec

**Current pipeline:**

```
1. Student submits text from the session route UI
2. UI calls submitNewUserMessage(sessionId, ...)
3. submitNewUserMessage():
   - runs compaction if needed
   - inserts the student message into the session store
   - creates an assistant placeholder message
   - calls generate(sessionId, assistantMessage, ...)
4. generate():
   - loads session + settings
   - builds prompt context
   - calls streamText(...)
5. streamText():
   - assembles available toolsets
   - injects tool instructions into the system prompt
   - invokes the model
   - streams assistant output and tool call results back into the assistant message
```

**Source-of-truth implementation points:**
- UI submit entrypoint: `chatbox/src/renderer/routes/session/$sessionId.tsx`
- Session message insertion: `chatbox/src/renderer/stores/session/messages.ts`
- Generation orchestration: `chatbox/src/renderer/stores/session/generation.ts`
- Model/tool orchestration: `chatbox/src/renderer/packages/model-calls/stream-text.ts`

**Design rule:**
- Student input enters the trusted TutorMeAI session store first.
- Third-party apps do not receive the raw student message directly unless the Bridge explicitly invokes an approved tool with structured parameters.

---

### US-7.2: The model only sees tools the student is allowed to use

**As a** student,
**I want** the chatbot to only consider tools from apps approved for my class,
**so that** unapproved apps cannot be invoked by accident or prompt manipulation.

#### Acceptance Criteria

- Tool lists are assembled at generation time, not hardcoded in the prompt.
- ChatBridge tools are included only when the session has an `activeClassId`.
- ChatBridge tools are generated only from apps that are both platform-approved and class-allowlisted.
- If a class has no approved ChatBridge apps, no ChatBridge tools are injected.
- A student prompt cannot invoke an app whose tool is absent from the assembled toolset.

#### Spec

**Tool injection boundary:**

```
streamText(...)
  ├── knowledge base tools
  ├── ChatBridge tools
  ├── file tools
  └── web tools
```

**ChatBridge tool loading sequence:**

```
1. streamText receives sessionId
2. streamText calls getChatBridgeToolSet(sessionId)
3. getChatBridgeToolSet():
   - loads the session
   - reads activeClassId from bridge/session state
   - resolves double-approved apps for that class
   - converts approved manifest tools into AI tool definitions
4. streamText appends the ChatBridge tool descriptions to toolSetInstructions
5. streamText merges the ChatBridge tool definitions into the tools object sent to the model
```

**Security rule:**
- The model can only call tools that are present in the runtime `tools` object.
- Therefore, approval enforcement must happen before the model call, at toolset assembly time.

---

### US-7.3: The model decides whether input is plain chat or app/tool usage

**As the** TutorMeAI platform,
**I want** the model to decide between normal response generation and tool use based on the current tool list and prompt context,
**so that** app routing feels conversational instead of requiring a separate command syntax.

#### Acceptance Criteria

- The model receives both the student message and the currently available tool descriptions in the same turn.
- Tool descriptions are the model's primary routing signal for deciding whether to call a tool.
- If no tool is appropriate, the model answers normally without invoking a tool.
- ChatBridge apps do not bypass the model and cannot self-activate from iframe messages alone.

#### Spec

**Routing model:**

```
Inputs to the model:
  - conversation history
  - system prompt
  - toolSetInstructions
  - current tool definitions
  - optional current bridge state summary

Model outputs:
  - plain assistant text
  - one or more tool calls
  - mixed tool/result + assistant text stream
```

**Bridge-specific rule:**
- ChatBridge does not run a separate intent classifier before the model in MVP.
- Routing is model-mediated: the model sees approved ChatBridge tools and decides whether to invoke them.
- This keeps app invocation aligned with the rest of Chatbox's tool use architecture.

**Future enhancement (post-MVP):**
- Add a light policy layer before model execution for explicit denials, confidence gating, or class-specific routing hints.

---

### US-7.4: Tool invocation activates the app without surrendering transcript control

**As the** ChatBridge platform,
**I want** ChatBridge tool execution to activate an app and update Bridge state,
**so that** the LLM can use app capabilities while the platform remains the gatekeeper.

#### Acceptance Criteria

- Executing a ChatBridge tool activates or resumes the corresponding app in Bridge state.
- Tool execution records the active app and tool name in the session's Bridge state.
- Tool execution returns a Bridge-authored result to the model.
- The app does not write directly to the chat transcript.

#### Spec

**Execution contract:**

```
1. Model calls approved ChatBridge tool
2. ChatBridge tool executor:
   - verifies session + class eligibility
   - marks the app active in bridgeState
   - records invocation metadata
   - returns a Bridge-authored tool result
3. If the app iframe is loaded, Bridge may send TOOL_INVOKE to the app
4. App responds via postMessage
5. Bridge validates, stores, and summarizes state
6. Only Bridge-authored summaries reach the transcript/LLM context
```

**Design rule:**
- The chat transcript is owned by TutorMeAI.
- Apps may contribute structured state, but they may not write transcript content directly.

---

### US-7.5: App state is injected into model context in a controlled way

**As the** TutorMeAI platform,
**I want** the model to receive only minimal, Bridge-authored app context,
**so that** the chatbot can reason over app progress without exposing raw untrusted state.

#### Acceptance Criteria

- Active app summaries are derived from validated Bridge state, not raw iframe payloads.
- Only manifest-approved `llmSafeFields` can contribute to app summaries.
- If no app is active, no app summary is injected.
- If an app is in an error state, the model receives a concise failure summary instead of raw error payloads.

#### Spec

**Context injection contract:**

```
At generation time:
1. Read bridgeState.activeAppId
2. Read bridgeState.appContext[activeAppId]
3. Filter lastState through llmSafeFields
4. Render summary using manifest.llmSummaryTemplate or fallback summary
5. Inject the resulting Bridge-authored text into the model system/context prompt
```

**Example injected summary:**

```
Active app: Chess
Current state: Mid-game. It is the student's turn. Material is roughly equal.
Last meaningful update: Student moved knight to f3.
```

**Never injected verbatim:**
- raw OAuth data
- unfiltered app payloads
- HTML or arbitrary strings from the iframe
- fields not marked as LLM-safe

---

### US-7.6: The routing path is observable for debugging and audit

**As a** platform engineer,
**I want** each generation turn to record whether the model answered normally or used ChatBridge tools,
**so that** I can debug routing mistakes and verify approval enforcement.

#### Acceptance Criteria

- Each generation turn emits structured events for:
  - message received
  - toolset assembled
  - model started
  - tool called
  - generation finished
- Logs include `sessionId`, `studentId` if available, `classId`, `activeAppId`, and invoked tool names.
- Failed tool resolution and denied app access are logged distinctly.
- Observability events do not include raw student content unless explicitly redacted/approved by policy.

#### Spec

**Minimum event model:**

```
GenerationStarted {
  sessionId
  classId
  provider
  model
  availableToolNames: string[]
}

ChatBridgeToolInvoked {
  sessionId
  classId
  appId
  toolName
  invocationSource: 'llm'
}

GenerationCompleted {
  sessionId
  finishReason
  invokedToolNames: string[]
}
```

**Implementation note:**
- MVP may emit these through the existing telemetry/logging path.
- Production should export them to the ChatBridge observability pipeline defined in Epic 8.
