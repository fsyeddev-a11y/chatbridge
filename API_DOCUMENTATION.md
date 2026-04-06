# ChatBridge API Documentation

**Base URL:** `https://<bridge-backend-domain>`

All endpoints require a Supabase Bearer token in the `Authorization` header unless noted otherwise.

## Authentication

```
Authorization: Bearer <supabase-jwt-token>
```

The backend extracts user identity from the JWT and injects role/membership context into each request.

---

## Health

### `GET /health`
No auth required.

**Response:** `200 OK`
```json
{ "status": "ok" }
```

---

## User Profile

### `GET /api/me`
Returns the authenticated user's profile, roles, school/class memberships.

**Response:**
```json
{
  "user": {
    "userId": "uuid",
    "email": "user@example.com",
    "role": "teacher",
    "roles": ["teacher"],
    "createdAt": 1712345678000,
    "updatedAt": 1712345678000
  },
  "schools": [{ "schoolId": "demo-school", "name": "Demo School" }],
  "schoolMemberships": [{ "schoolId": "demo-school", "userId": "uuid", "membershipRole": "teacher" }],
  "classes": [{ "classId": "demo-class", "name": "Demo Class", "schoolId": "demo-school" }],
  "classMemberships": [{ "classId": "demo-class", "userId": "uuid", "membershipRole": "teacher" }]
}
```

---

## Chat Sessions

### `GET /api/chat-sessions`
List all chat sessions for the authenticated user.

### `GET /api/chat-sessions/:sessionId`
Get a specific session with messages and bridge state.

### `PUT /api/chat-sessions/:sessionId`
Create or update a chat session.

**Body:**
```json
{
  "session": {
    "id": "uuid",
    "name": "My Chat",
    "type": "chat",
    "messages": [...],
    "settings": { "provider": "chatbridge-backend", "modelId": "gpt-4o-mini" }
  },
  "previousSessionId": "uuid (optional)"
}
```

### `DELETE /api/chat-sessions/:sessionId`
Delete a chat session.

### `PUT /api/chat-sessions/reorder`
Reorder the session list.

**Body:**
```json
{ "sessionIds": ["id1", "id2", "id3"] }
```

---

## Chat Generation

### `POST /api/chat/generate`
Non-streaming chat completion with tool orchestration.

**Body:**
```json
{
  "sessionId": "uuid",
  "classId": "demo-class",
  "messages": [
    { "role": "user", "content": "Let's play chess" }
  ]
}
```

**Response:**
```json
{
  "content": "I've opened Chess Coach for you!",
  "model": "gpt-4o-mini",
  "toolResults": [
    {
      "appId": "chess",
      "appName": "Chess Coach",
      "toolName": "chatbridge_chess_start_game",
      "status": "opened"
    }
  ],
  "bridgeState": { "activeAppId": "chess", "activeClassId": "demo-class" }
}
```

### `POST /api/chat/stream`
Streaming chat via Server-Sent Events.

**Body:** Same as `/api/chat/generate`

**SSE Events:**
```
event: started
data: {"model":"gpt-4o-mini"}

event: delta
data: {"content":"I've opened"}

event: tool_result
data: {"appId":"chess","toolName":"chatbridge_chess_start_game","status":"opened"}

event: completed
data: {"content":"Full response...","model":"gpt-4o-mini","bridgeState":{...}}

event: error
data: {"error":"Something went wrong"}
```

---

## App Registry

### `GET /api/registry/apps`
List all registered apps. Requires admin or governance access.

### `GET /api/registry/apps/:appId`
Get a specific app's manifest and review state.

### `POST /api/registry/apps`
Register a new app. Requires `developer` or `admin` role.

**Body:**
```json
{
  "manifest": {
    "appId": "my-app",
    "name": "My App",
    "version": "1.0.0",
    "description": "...",
    "developerName": "Dev Name",
    "executionModel": "iframe",
    "launchUrl": "https://my-app.example.com",
    "allowedOrigins": ["https://my-app.example.com"],
    "authType": "none",
    "tools": [{ "name": "chatbridge_my_app_open", "description": "Open my app" }],
    "llmSafeFields": ["score"],
    "subjectTags": ["Science"]
  }
}
```

**Response:** `201 Created`

### `POST /api/registry/apps/:appId/review`
Approve or reject an app. Requires `admin` role.

**Body:**
```json
{
  "reviewState": "approved",
  "notes": "Looks good",
  "version": "1.0.0"
}
```

---

## Developer Apps

### `GET /api/developer/apps`
List apps owned by the authenticated developer.

### `GET /api/developer/review-actions`
List review actions on the developer's apps.

---

## School Allowlist

### `GET /api/schools/:schoolId/allowlist`
List apps enabled for a school. Requires school_admin or admin.

### `POST /api/schools/:schoolId/allowlist`
Enable an app for a school.

**Body:** `{ "appId": "chess" }`

### `POST /api/schools/:schoolId/allowlist/:appId/disable`
Disable an app for a school.

---

## Class Allowlist

### `GET /api/classes/:classId/apps`
List approved and enabled apps for a class. Used by the app shelf.

### `GET /api/classes/:classId/allowlist`
List the class allowlist. Requires teacher or admin.

### `POST /api/classes/:classId/allowlist`
Enable an app for a class (must already be enabled at school level).

**Body:** `{ "appId": "chess" }`

### `POST /api/classes/:classId/allowlist/:appId/disable`
Disable an app for a class.

---

## Bridge Session State

### `GET /api/sessions/:sessionId/bridge-state`
Get the active app state for a session.

**Response:**
```json
{
  "bridgeState": {
    "activeAppId": "chess",
    "activeClassId": "demo-class",
    "appContext": {
      "chess": {
        "appId": "chess",
        "status": "active",
        "summary": "Opening position after 3 moves",
        "lastState": { "fen": "...", "phase": "opening" }
      }
    }
  }
}
```

### `PUT /api/sessions/:sessionId/bridge-state`
Update bridge state (called by frontend when app sends STATE_UPDATE).

**Body:**
```json
{
  "bridgeState": {
    "activeAppId": "chess",
    "activeClassId": "demo-class",
    "appContext": { ... }
  }
}
```

---

## OAuth

### `GET /api/oauth/apps/:appId/status`
Check if the user has connected an OAuth app.

**Response:**
```json
{
  "appId": "google-classroom",
  "provider": "google",
  "connected": true,
  "scopes": ["classroom.courses.readonly"]
}
```

### `POST /api/oauth/apps/:appId/start`
Start OAuth flow. Returns the authorization URL.

**Body:** `{ "sessionId": "uuid" }`

**Response:**
```json
{
  "appId": "google-classroom",
  "provider": "google",
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

### `POST /api/oauth/apps/:appId/revoke`
Revoke stored OAuth tokens.

### `GET /oauth/callback`
OAuth callback endpoint (not called directly — handles the redirect from the OAuth provider).

---

## Audit Events

### `POST /api/audit/events`
Submit an audit event from the frontend.

### `GET /api/audit/events`
Retrieve audit log. Requires admin.

---

## Rate Limits

Rate limits are applied per-user, per-session, and per-app:

| Scope | Default | Configurable Via |
|-------|---------|-----------------|
| Chat per user | Unlimited | `CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS` |
| Chat per session | Unlimited | `CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS` |
| Mutations per user | Unlimited | `CHATBRIDGE_MUTATION_RATE_LIMIT_MAX_REQUESTS` |
| Tool per user per app | Unlimited | `CHATBRIDGE_TOOL_RATE_LIMIT_MAX_REQUESTS` |

When rate limited, endpoints return `429 Too Many Requests` with `retryAfterMs`.

---

## Roles & Permissions

| Role | Can Chat | Can Manage Apps | Can Approve Apps | Can Manage Classes |
|------|----------|----------------|-----------------|-------------------|
| student | Yes | No | No | No |
| teacher | Yes | Own classes | No | Own classes |
| school_admin | Yes | Own school's classes | No | Own school |
| developer | Yes | No (can register) | No | No |
| admin | Yes | All | Yes | All |
