# ChatBridge Developer Guide

Build third-party apps that run inside the TutorMeAI chat experience. This guide covers everything you need to register, build, and deploy a ChatBridge app.

## How It Works

ChatBridge apps run in **sandboxed iframes** inside the chat UI. Communication between your app and the platform uses **postMessage** with a structured envelope protocol. The platform handles:

- **Discovery:** Your app's tools are injected into the LLM's context
- **Invocation:** When a student asks for your app, the LLM calls your tool and the platform opens your iframe
- **State:** Your app sends state updates that the chatbot can reference
- **Security:** Iframes are sandboxed; the platform owns OAuth tokens; data flows through validated envelopes

```
Student: "Let's play chess"
    → LLM calls chatbridge_chess_start_game tool
    → Platform opens Chess Coach iframe
    → Student plays, app sends STATE_UPDATE
    → Student: "What should I do here?"
    → LLM reads board state from app context
    → LLM responds with chess advice
    → Student finishes, app sends APP_COMPLETE
    → Conversation continues normally
```

## App Manifest

Every app is defined by a manifest submitted to the platform registry:

```json
{
  "appId": "my-app",
  "name": "My Education App",
  "version": "1.0.0",
  "description": "A brief description for teachers and the LLM.",
  "developerName": "Your Name",
  "executionModel": "iframe",
  "launchUrl": "https://my-app.example.com",
  "allowedOrigins": ["https://my-app.example.com"],
  "heartbeatTimeoutMs": 10000,
  "authType": "none",
  "subjectTags": ["Science", "Math"],
  "gradeBand": "K-12",
  "llmSafeFields": ["score", "topic"],
  "tools": [
    {
      "name": "chatbridge_my_app_open",
      "description": "Open My Education App for the student."
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `appId` | Unique identifier (kebab-case) |
| `executionModel` | Always `"iframe"` |
| `launchUrl` | URL loaded in the iframe |
| `allowedOrigins` | Origins from which postMessage is accepted |
| `authType` | `"none"`, `"api-key"`, or `"oauth2"` |
| `llmSafeFields` | Dot-paths of state fields safe to share with the LLM |
| `tools` | Array of tools the LLM can invoke to open your app |
| `heartbeatTimeoutMs` | How long before the platform considers your app unresponsive (default: 10s) |

## PostMessage Protocol

### Envelope Format

All messages use this envelope structure:

**App → Host:**
```javascript
{
  source: "chatbridge-app",
  version: "1.0",
  appId: "my-app",
  type: "APP_READY" | "STATE_UPDATE" | "APP_COMPLETE" | "APP_ERROR" | "HEARTBEAT",
  payload: { ... }
}
```

**Host → App:**
```javascript
{
  source: "chatbridge-host",
  version: "1.0",
  appId: "my-app",
  type: "INIT" | "PING" | "TERMINATE" | "AUTH_RESULT",
  payload: { ... }
}
```

### Message Flow

1. **Host sends `INIT`** after iframe loads — includes `sessionId`, `classId`, `previousState` (if resuming)
2. **App sends `APP_READY`** to confirm initialization
3. **Host sends `PING`** periodically — app must respond with `HEARTBEAT`
4. **App sends `STATE_UPDATE`** whenever state changes (with summary + state object)
5. **App sends `APP_COMPLETE`** when the interaction is done
6. **Host sends `TERMINATE`** when the session ends

### Bridge Helper

Use this reusable bridge module (copy from any demo app):

```javascript
import { createBridge } from './bridge.js'

const bridge = createBridge({
  appId: 'my-app',
  onInit(payload) {
    // payload.sessionId, payload.classId, payload.previousState
    bridge.sendReady('App is ready.')
  },
  onPing() {
    // Heartbeat is auto-responded by the bridge
  },
  onTerminate(payload) {
    // Clean up
  },
})

// Send state updates
bridge.sendStateUpdate('Student scored 5/10', { score: 5, total: 10 })

// Signal completion
bridge.sendComplete('Quiz finished. Score: 8/10.', { score: 8, total: 10 })

// Report errors
bridge.sendError('Failed to load questions.')
```

## App Registration

### Via Developer Portal (UI)

1. Log in with a developer account
2. Go to Settings → ChatBridge Workspace → Developer Portal
3. Paste your manifest JSON and submit
4. Your app enters `pending` review state
5. A platform admin approves → `approved`
6. A school admin enables it for their school
7. A teacher enables it for their class
8. Students can now use it

### Three-Gate Approval

```
Developer submits → Platform Admin approves → School Admin enables → Teacher activates
```

Apps only appear to students after passing all three gates.

## Auth Types

### No Auth (`authType: "none"`)
Simplest. App loads in iframe, no credentials needed. Good for self-contained apps.

**Examples:** Chess, Trivia, Calculator

### OAuth2 (`authType: "oauth2"`)
The **platform** handles the OAuth flow — your iframe never sees tokens. Flow:

1. User clicks "Connect" in the app shelf
2. Platform opens OAuth popup → user authorizes
3. Platform stores encrypted tokens in Supabase
4. Platform sends `AUTH_RESULT` to your iframe
5. Your iframe shows "Connected" state

Your app receives `AUTH_RESULT` via postMessage:
```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'AUTH_RESULT') {
    if (event.data.payload.success) {
      // User authorized — update UI
    }
  }
})
```

**Examples:** Google Classroom

## Iframe Sandbox Policy

Apps run with these sandbox attributes:
- `allow-scripts` — JavaScript execution
- `allow-forms` — Form submission
- `allow-popups` — Window.open (for OAuth redirects)
- `allow-same-origin` — Only if `launchUrl` is set (needed for same-origin API calls)

Apps **cannot**:
- Access the parent DOM
- Navigate the parent frame
- Access cookies/storage of the parent origin

## State & Context

### `llmSafeFields`

Only fields listed in `llmSafeFields` are shared with the LLM. This prevents leaking sensitive state:

```json
{
  "llmSafeFields": ["score", "topic", "difficulty"]
}
```

If your state is `{ score: 5, topic: "Science", secretKey: "abc123" }`, only `score`, `topic`, and `difficulty` reach the LLM.

### State Persistence

The platform persists your app's last state. When a user returns to a session, your `onInit` callback receives `previousState` so you can restore:

```javascript
onInit(payload) {
  if (payload.previousState) {
    restoreFrom(payload.previousState)
  }
  bridge.sendReady('Restored previous session.')
}
```

## Local Development

1. Serve your app locally (e.g., `python3 -m http.server 4175`)
2. Set the env var on bridge-backend: `CHATBRIDGE_MY_APP_URL=http://localhost:4175`
3. Register your manifest with `launchUrl` pointing to localhost
4. Open the chatbox frontend and test

## Deployment

Deploy your app as a static site on any hosting provider (Railway, Vercel, Netlify, etc.). Then:

1. Set `CHATBRIDGE_MY_APP_URL=https://your-app.example.com` on the bridge-backend
2. Redeploy the backend
3. Your manifest's `launchUrl` and `allowedOrigins` will be updated automatically

## Example Apps

| App | Complexity | Auth | Source |
|-----|-----------|------|--------|
| Weather Dashboard | Low | None | `weather-app/` |
| Science Trivia | Medium | None | `trivia-app/` |
| Chess Coach | High | None | `chess-app/` |
| Google Classroom | Medium | OAuth2 | `classroom-app/` |
