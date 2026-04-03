# Epic 5: Error Recovery & Resilience

## Context

The core product rule: **the chat never dies because an app did.** Third-party apps are untrusted code running in iframes. They can crash, hang, send garbage, or behave maliciously. The Bridge must degrade gracefully in every case while keeping the conversation alive.

Today, `ChatBridgePanel.tsx` handles `APP_ERROR` messages and displays them, but there's no timeout detection, no retry logic, no iframe teardown, and no LLM-facing failure communication.

---

## User Stories

### US-5.1: Bridge detects and recovers from app crashes

**As a** student,
**I want** the chat to keep working even if a ChatBridge app crashes,
**so that** a broken app doesn't ruin my tutoring session.

#### Acceptance Criteria

- If the iframe fires an `error` event or stops responding to PINGs, the Bridge marks the app as errored.
- The errored app's iframe is removed from the DOM.
- The chat continues normally; the LLM is informed the app became unavailable.
- The student sees a clear message: "The app stopped working. You can continue chatting or try reopening it."
- The student can re-launch the app from the shelf.

#### Spec

**Crash detection signals:**

| Signal | Detection | Response |
|--------|-----------|----------|
| `APP_ERROR` message | PostMessage handler | Mark error, show message, keep iframe for potential recovery |
| No `APP_READY` after `INIT` | Startup timeout based on `heartbeatTimeoutMs` | Tear down iframe, mark error |
| PING timeout | No `HEARTBEAT` within 5000ms of `PING` | Retry PING once. If second PING times out, tear down iframe, mark error |
| Iframe `error` event (best-effort) | DOM event listener on iframe | Treat as advisory signal only; mark error if corroborated by startup timeout or missed heartbeats |

**Recovery sequence:**

```
1. Detect failure (any signal above)
2. Update appContext:
   status: 'error'
   lastError: descriptive message
   lastState: preserved (last valid state before crash)
3. If iframe still in DOM and failure is non-recoverable: remove iframe
4. Clear activeAppId from bridgeState
5. Render error alert in ChatBridgePanel with:
   - What happened (plain language)
   - "Reopen App" button
   - "Continue without app" implicit (chat is always available)
6. On next LLM turn, inject into context:
   "The {appName} app encountered an error and is no longer active.
    Last known state: {summary}. Continue assisting the student without the app."
```

---

### US-5.2: Bridge detects and handles app hangs

**As the** ChatBridge platform,
**I want** to detect apps that stop responding without crashing,
**so that** students don't stare at a frozen iframe indefinitely.

#### Acceptance Criteria

- The Bridge sends periodic `PING` messages to the active app iframe.
- If two consecutive PINGs go unanswered, the app is considered hung.
- A hung app is treated the same as a crashed app (US-5.1 recovery sequence).
- The PING interval is configurable per app via `heartbeatTimeoutMs` in the manifest.

#### Spec

**Heartbeat protocol:**

```
- PING interval: every (heartbeatTimeoutMs / 2), default every 5000ms
- Timeout per PING: heartbeatTimeoutMs, default 10000ms
- Retries before teardown: 1 (send PING, wait, retry once, wait, then tear down)
- PINGs only sent when app status is 'ready' or 'active'
- PINGs are NOT sent when app status is 'idle', 'error', or 'complete'
```

**Implementation:**
- `useEffect` in `ChatBridgePanel` starts a PING interval when `activeApp` is set and status is 'ready' or 'active'.
- Each PING sets a pending flag. Incoming `HEARTBEAT` clears it.
- If the flag is still set when the next PING fires, increment a miss counter.
- Two consecutive misses → trigger recovery sequence.
- Cleanup: clear interval on unmount or app deactivation.

---

### US-5.3: Bridge rejects invalid state and preserves last good state

**As the** ChatBridge platform,
**I want** to reject malformed or schema-violating state updates while keeping the last valid state,
**so that** a buggy app can't corrupt the session context.

#### Acceptance Criteria

- `STATE_UPDATE` payloads that fail schema validation are silently dropped.
- The Bridge retains the previous valid `appContext.lastState`.
- A counter tracks consecutive invalid payloads per app per session.
- After 5 consecutive invalid payloads, the Bridge sends the app a `TERMINATE { reason: 'repeated_invalid_state' }` and marks the app as errored.
- The student is not shown raw validation errors; they see a generic "The app is having trouble" message.
- Stateful apps without declared `stateSchema` / `completionSchema` are treated as protocol-invalid and cannot update persistent Bridge state.

#### Spec

**Validation pipeline (runs in the `STATE_UPDATE` handler):**

```
1. Parse envelope (already done by isBridgeEnvelope)
2. Check payload.state exists and is an object
3. Require manifest.stateSchema for STATE_UPDATE and manifest.completionSchema for APP_COMPLETE
4. Validate payload.state against the relevant schema
5. On failure: increment invalidCounter, log, return (keep previous state)
6. Sanitize payload.summary (strip HTML, truncate 500 chars)
7. Filter payload.state through manifest.llmSafeFields for LLM context
8. Call updateBridgeAppContext with validated state
9. Reset invalidCounter on success
```

**Invalid payload tracking:**

```
AppValidationState {
  consecutiveInvalidCount: number  // Reset on valid payload
  totalInvalidCount: number        // Cumulative for audit
  lastInvalidAt: number
  lastInvalidReason: string
}
```

---

### US-5.4: Tool invocation timeout and fallback

**As the** ChatBridge platform,
**I want** tool invocations that don't get a response from the app to time out gracefully,
**so that** the LLM doesn't hang waiting for a broken app.

#### Acceptance Criteria

- When the Bridge sends `TOOL_INVOKE` to an app, it starts a timer (default 10s, configurable via manifest).
- If the app responds with a `STATE_UPDATE` or `APP_ERROR` carrying the matching `correlationId`, the timer is cleared.
- If the timer expires, the tool returns an error result to the LLM.
- The LLM receives a structured error it can act on: tell the student the app didn't respond.

#### Spec

**Tool invocation timeout flow:**

```
1. TOOL_INVOKE sent to iframe with correlationId
2. Start timer: manifest.heartbeatTimeoutMs or 10000ms
3. Wait for STATE_UPDATE or APP_ERROR with matching correlationId

   On response received:
     - Clear timer
     - Process normally (validate state, update context)
     - Return result to LLM

   On timeout:
     - Return to LLM: {
         error: 'tool_timeout',
         appId, toolName,
         message: '{appName} did not respond in time. The app may be experiencing issues.'
       }
     - Update appContext.status to 'error'
     - Send PING to check if app is still alive (may trigger hang detection)
```

**LLM behavior guidance (injected in system prompt):**
- If a tool returns `tool_timeout`, tell the student the app is having trouble and offer to try again or continue without it.
- Do not retry the tool automatically — let the student decide.

---

### US-5.5: Graceful degradation on app disable or suspension

**As a** student,
**I want** a clear message when an app I was using gets disabled,
**so that** I understand what happened and can keep chatting.

#### Acceptance Criteria

- When an app is disabled (teacher) or suspended (admin) mid-session, the student sees a non-alarming notification.
- The chat thread is unaffected.
- The LLM is told the app was removed and adjusts its responses.
- Previously collected app state (summaries, completion events) remain in the session history.

#### Spec

**Disable/suspend notification:**

```
Alert (yellow, info variant):
  "The {appName} app is no longer available for this class.
   Your conversation and any progress are saved."
```

**LLM context update:**
```
"The {appName} app was removed from this class by the teacher/platform.
 Last known state: {summary}. Continue tutoring without the app.
 Do not suggest re-opening the app."
```

**State preservation:**
- `appContext` for the removed app is NOT deleted from `bridgeState`.
- `appContext.status` is set to `'error'`.
- `appContext.lastError` is set to `'App disabled'` or `'App suspended'`.
- Historical summaries remain available to the LLM for continuity.
