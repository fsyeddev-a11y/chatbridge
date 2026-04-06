# Spec 20 - Initial Message Flicker Bug

**Status:** Open  
**Severity:** Medium (UX issue, no data loss)  
**Affects:** Platform Admin, Teacher roles  
**Does NOT affect:** Developer role (no class context)

## Problem

When a user starts a **brand new conversation**, the first user message flickers:

1. Message appears in the chat
2. Message disappears
3. Message reappears
4. Message disappears
5. LLM response shows (without the user message visible)

This **only** happens on the initial message in a new session. Subsequent messages in an active conversation render correctly with no flicker.

## Observed Behavior by Role

| Role | Flicker? | Notes |
|------|----------|-------|
| Platform Admin | Yes | Message ultimately disappears, LLM response shows |
| Teacher | Yes | Same behavior as Platform Admin |
| Developer | No | Message reappears and stays; slight visual jitter but no loss |
| Student | Untested | |

The developer role does not have a `classId` set (no class membership), which changes the backend chat flow. This may be relevant to root cause.

## What Has Been Tried

### Attempt 1: Fix merge logic in `mergeSessionWithLocalConversation`
**File:** `chatbox/src/renderer/stores/chatStore.ts:167-193`

Changed the merge logic to only prefer backend state when backend is strictly ahead (has messages local doesn't, AND local has no messages backend doesn't). Previously the condition `localMessageIds.size <= backendMessageIds.size` would let backend overwrite local even when local had unique messages.

**Result:** Did not fix the flicker.

### Attempt 2: Remove `refreshSessionFromBackendBestEffort` calls
**File:** `chatbox/src/renderer/stores/session/generation.ts`

Removed all three fire-and-forget `refreshSessionFromBackendBestEffort(sessionId)` calls after generation completes (lines 316, 377, 420). These fetched the session from backend and merged it into local cache, potentially overwriting local state with stale data.

**Result:** Did not fix the flicker.

## Architecture Context

### New Session + First Message Flow

1. **Index page** (`routes/index.tsx:128-136`): User types message, `createEmpty('chat')` creates session via `chatStore.createSession`, which calls `upsertBackendSession` and sets cache with `persisted.session` (system prompt only, no user message yet). Then `switchCurrentSession` navigates to `/session/:id`.

2. **Session page mounts** (`routes/session/$sessionId.tsx:66-87`): `useEffect` picks up `pendingSubmission` from UI store and calls `submitNewUserMessage`.

3. **submitNewUserMessage** (`stores/session/messages.ts:111-200`):
   - `await insertMessage(sessionId, userMsg)` — adds user message to cache + persists via UpdateQueue
   - `await insertMessage(sessionId, assistantMsg)` — adds empty assistant message + persists
   - Calls `generate(sessionId, assistantMsg)`

4. **generate** (`stores/session/generation.ts:137-420`):
   - `await modifyMessage(sessionId, targetMsg)` — persists assistant msg with `generating: true`
   - `await generateBackendChat(promptMsgs, options)` — calls backend `/api/chat/generate`
   - `await modifyMessage(sessionId, targetMsg, true)` — persists final assistant response

### Key Data Flow Components

- **React Query cache** (`queryClient.setQueryData`): Optimistic UI updates, drives `useSession` hook
- **UpdateQueue** (`stores/updateQueue.ts`): Batches and serializes backend persistence via microtasks
- **`_setSessionCache`** (`chatStore.ts:148-151`): Updates React Query cache
- **`upsertBackendSession`** (`packages/backend-sessions.ts:51-78`): PUT to backend, returns persisted session

### Multiple Cache Writers

During the first message flow, `_setSessionCache` is called from multiple async paths:

1. `createSession` line 221 — sets `persisted.session` (from backend, no user message)
2. `updateSessionWithMessages` line 281 — optimistic cache update (has user message)
3. `UpdateQueue.onChange` line 265 — `_setSessionCache(sessionId, session)` with local state after backend persist
4. `updateSessionWithMessages` line 318 — `_setSessionCache(sessionId, updated)` after queue resolves

The flicker suggests these writes are interleaving in an order that temporarily removes the user message from the rendered state.

## Hypotheses to Investigate

### H1: Race between `createSession` cache and `insertMessage` optimistic update
`createSession` sets cache with backend session (no user message). If React renders between this set and the `insertMessage` optimistic update, the message briefly disappears.

### H2: UpdateQueue flush overwrites optimistic state
When the UpdateQueue flushes and calls `upsertBackendSession`, the response triggers `_setSessionCache`. If the backend response arrives with an older state (e.g., from a previous flush), it could overwrite the current optimistic state.

### H3: React Query internal deduplication
`getSession` calls `fetchQuery` which may trigger a background refetch in certain conditions, returning stale backend data that overwrites the cache.

### H4: Class context affects backend session shape
Developer role (no flicker) has no `classId`. Platform Admin and Teacher have `classId: 'demo-class'`. The backend may process or return the session differently when a class context is present (e.g., `sanitizeBridgeStateForUser` or `mergeCanonicalBridgeStateIntoSession` modifying the response).

## Key Files

| File | Relevance |
|------|-----------|
| `chatbox/src/renderer/stores/chatStore.ts` | Session cache, merge logic, UpdateQueue setup |
| `chatbox/src/renderer/stores/session/generation.ts` | Generation flow, message modification |
| `chatbox/src/renderer/stores/session/messages.ts` | `submitNewUserMessage`, `insertMessage` |
| `chatbox/src/renderer/stores/updateQueue.ts` | Batched persistence with microtask scheduling |
| `chatbox/src/renderer/routes/index.tsx` | New session creation + pendingSubmission |
| `chatbox/src/renderer/routes/session/$sessionId.tsx` | Session mount, pendingSubmission handling |
| `chatbox/src/renderer/packages/backend-sessions.ts` | `upsertBackendSession` |

## Suggested Next Steps

1. Add `console.log` tracing to every `_setSessionCache` call site with the message count, to capture the exact interleaving order in production
2. Test with network throttling to amplify race conditions
3. Compare the session payloads returned by backend for developer (no classId) vs admin (with classId)
4. Consider making `createSession` + first `insertMessage` atomic — create the session with the user message already included rather than creating empty then inserting
