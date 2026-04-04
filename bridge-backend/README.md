# ChatBridge Bridge Backend

Fastify backend for the ChatBridge control plane.

Current scope:
- health route
- registry read routes
- class allowlist read routes
- audit event ingestion
- file-backed store for registry, allowlist, and audit events
- optional Supabase/Postgres-backed store driver for registry, allowlist, review actions, and audit events
- backend-owned Bridge session state routes for `activeAppId`, `activeClassId`, and `appContext`

Planned next:
- persistent registry store
- platform approval mutations
- teacher allowlist mutations
- app session persistence
- provider-backed OAuth token refresh and API execution

Default local file store path:
- `bridge-backend/data/bridge-store.json`

Store driver selection:
- `CHATBRIDGE_STORE_DRIVER=file` (default)
- `CHATBRIDGE_STORE_DRIVER=supabase`

File store override:
- `CHATBRIDGE_STORE_PATH=/custom/path/bridge-store.json`

Supabase schema:
- apply [schema.sql](/Users/fsyed/Documents/ChatBridge/bridge-backend/supabase/schema.sql) in your Supabase SQL editor before enabling `CHATBRIDGE_STORE_DRIVER=supabase`

Deployment-related environment variables:
- `CHATBRIDGE_ALLOWED_ORIGINS=https://chatbox.example.com,https://weather.example.com`
- `CHATBRIDGE_WEATHER_APP_URL=https://weather.example.com`
- `CHATBRIDGE_PUBLIC_BACKEND_ORIGIN=https://chatbridge-backend.example.com`
- `CHATBRIDGE_GOOGLE_OAUTH_CLIENT_ID=...`
- `CHATBRIDGE_GOOGLE_OAUTH_CLIENT_SECRET=...`
- `CHATBRIDGE_GOOGLE_OAUTH_SUPPORTED_SCOPES=https://www.googleapis.com/auth/classroom.courses.readonly,https://www.googleapis.com/auth/classroom.coursework.me.readonly`
- `CHATBRIDGE_OAUTH_STATE_SECRET=...`
- `CHATBRIDGE_OAUTH_TOKEN_SECRET=...`
