# ChatBridge Bridge Backend

Fastify backend for the ChatBridge control plane.

Current scope:
- health route
- registry read routes
- class allowlist read routes
- audit event ingestion
- file-backed store for registry, allowlist, and audit events

Planned next:
- persistent registry store
- platform approval mutations
- teacher allowlist mutations
- OAuth orchestration
- app session persistence

Default local store path:
- `bridge-backend/data/bridge-store.json`

Override with:
- `CHATBRIDGE_STORE_PATH=/custom/path/bridge-store.json`

Deployment-related environment variables:
- `CHATBRIDGE_ALLOWED_ORIGINS=https://chatbox.example.com,https://weather.example.com`
- `CHATBRIDGE_WEATHER_APP_URL=https://weather.example.com`
