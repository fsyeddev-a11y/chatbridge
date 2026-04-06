# ChatBridge

An AI chat platform with third-party app integration for K-12 education. Built on a fork of [Chatbox](https://github.com/nicepkg/chatbox), ChatBridge enables third-party educational apps to run inside the chat experience through sandboxed iframes with a structured postMessage protocol.

**Deployed:** [chatbridge-production-6c94.up.railway.app](https://chatbridge-production-6c94.up.railway.app)

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  Third-Party Apps (sandboxed iframes)                │
│  Chess Coach │ Weather │ Trivia │ Google Classroom    │
└───────────┬──────────────────────────────────────────┘
            │ postMessage (envelope protocol)
┌───────────▼──────────────────────────────────────────┐
│  Chatbox Frontend (React + Vite)                     │
│  - Chat UI with message history                      │
│  - App shelf (toolbar dropdown)                      │
│  - Iframe lifecycle management                       │
│  - Bridge state sync                                 │
└───────────┬──────────────────────────────────────────┘
            │ REST + SSE
┌───────────▼──────────────────────────────────────────┐
│  Bridge Backend (Fastify + TypeScript)               │
│  - OpenAI function calling with dynamic tool injection│
│  - App registry with 3-gate approval                 │
│  - OAuth orchestration (Google)                      │
│  - Role-based access (admin/school_admin/teacher/    │
│    developer/student)                                │
│  - Rate limiting, audit logging                      │
└───────────┬──────────────────────────────────────────┘
            │
┌───────────▼──────────────────────────────────────────┐
│  Supabase (Postgres + Auth)                          │
│  - User profiles & roles                             │
│  - Chat sessions & message history                   │
│  - App registry & version tracking                   │
│  - School/class memberships & allowlists             │
│  - Encrypted OAuth tokens                            │
│  - Audit events                                      │
└──────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Iframes for isolation:** Third-party apps cannot access the parent DOM, student data, or other apps
- **Platform owns tokens:** OAuth credentials never reach the iframe
- **Three-gate approval:** Platform admin approves → School admin enables → Teacher activates per class
- **LLM-safe fields:** Manifests declare which state fields can be shared with the AI
- **Backend-owned generation:** Chat completions and tool orchestration happen server-side

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Mantine, TanStack Router/Query, Jotai |
| Backend | Fastify 5, TypeScript, Zod validation |
| AI | OpenAI gpt-4o-mini with function calling |
| Auth | Supabase Auth (JWT) |
| Database | Supabase (PostgreSQL) |
| Real-time | Server-Sent Events for streaming chat |
| App Sandbox | Iframes with postMessage protocol |
| Deployment | Railway (4 services) |

## Third-Party Apps

| App | Description | Auth | API |
|-----|------------|------|-----|
| Chess Coach | Interactive chess board with Stockfish AI | None | — |
| Weather Dashboard | Current weather lookup | None | Open-Meteo |
| Science Trivia | Multiple-choice quiz (6 categories, 3 difficulties) | None | Open Trivia DB |
| Google Classroom | Classroom data access | OAuth2 | Google Classroom API |

## Setup Guide

### Prerequisites

- Node.js >= 22
- pnpm
- Supabase project (free tier works)
- OpenAI API key

### 1. Clone and install

```bash
git clone https://labs.gauntletai.com/faheemsyed/chatbridge.git
cd chatbridge
```

### 2. Set up Supabase

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the schema in `bridge-backend/supabase/schema.sql` via the SQL editor
3. Create users in Authentication → Users for each role you want to test

### 3. Start the bridge backend

```bash
cd bridge-backend
npm install
cp .env.example .env  # or create .env with the variables below
npm run dev
```

**Required environment variables:**

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI
OPENAI_API_KEY=sk-...

# Store
CHATBRIDGE_STORE_DRIVER=supabase

# CORS
CHATBRIDGE_ALLOWED_ORIGINS=http://localhost:1420

# Roles (comma-separated emails)
CHATBRIDGE_ADMIN_EMAILS=admin@example.com
CHATBRIDGE_TEACHER_EMAILS=teacher@example.com
CHATBRIDGE_DEVELOPER_EMAILS=dev@example.com
CHATBRIDGE_SCHOOL_ADMIN_EMAILS=schooladmin@example.com

# App URLs (defaults to localhost if not set)
CHATBRIDGE_WEATHER_APP_URL=http://localhost:4173
CHATBRIDGE_CHESS_APP_URL=http://localhost:4174
CHATBRIDGE_TRIVIA_APP_URL=http://localhost:4175
CHATBRIDGE_CLASSROOM_APP_URL=http://localhost:4176

# OAuth (optional, for Google Classroom)
CHATBRIDGE_GOOGLE_OAUTH_CLIENT_ID=...
CHATBRIDGE_GOOGLE_OAUTH_CLIENT_SECRET=...
CHATBRIDGE_OAUTH_STATE_SECRET=random-32-char-string
CHATBRIDGE_OAUTH_TOKEN_SECRET=random-32-char-string
```

### 4. Start the frontend

```bash
cd chatbox
pnpm install
CHATBRIDGE_API_ORIGIN=http://localhost:8787 pnpm run dev:web
```

### 5. Start third-party apps

```bash
# In separate terminals:
cd weather-app && npx serve -s . -l 4173
cd chess-app && npm install && npx serve -s . -l 4174
cd trivia-app && npx serve -s . -l 4175
cd classroom-app && npx serve -s . -l 4176
```

### 6. Open the app

Navigate to `http://localhost:1420`, sign in with a Supabase user, and start chatting.

## Deployment (Railway)

See [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md) for detailed Railway deployment instructions.

**Services:**

| Service | Root Directory | Start Command |
|---------|---------------|---------------|
| bridge-backend | `bridge-backend` | `npm start` |
| chatbox-web | `chatbox` | Static site (build output) |
| weather-app | `weather-app` | `npx serve -s . -l $PORT` |
| chess-app | `chess-app` | `npx serve -s . -l $PORT` |
| trivia-app | `trivia-app` | `npx serve -s . -l $PORT` |
| classroom-app | `classroom-app` | `npx serve -s . -l $PORT` |

## Documentation

- [Developer Guide](DEVELOPER_GUIDE.md) — How to build a ChatBridge third-party app
- [API Documentation](API_DOCUMENTATION.md) — Full REST API reference
- [AI Cost Analysis](AI_COST_ANALYSIS.md) — Development costs and production projections
- [Specs](specs/) — 20 detailed engineering specs covering the full platform

## Project Structure

```
chatbridge/
├── chatbox/           # Frontend (forked Chatbox, web-only mode)
├── bridge-backend/    # Backend (Fastify + Supabase)
├── chess-app/         # Third-party app: Chess Coach
├── weather-app/       # Third-party app: Weather Dashboard
├── trivia-app/        # Third-party app: Science Trivia
├── classroom-app/     # Third-party app: Google Classroom (OAuth)
├── specs/             # Engineering specifications
├── AI_COST_ANALYSIS.md
├── API_DOCUMENTATION.md
├── DEVELOPER_GUIDE.md
└── DEPLOY_RAILWAY.md
```

## Roles

| Role | Capabilities |
|------|-------------|
| Platform Admin | Full access, app approval, all settings |
| School Admin | Manage school-level app allowlists, view classes |
| Teacher | Manage class-level app activation, view workspace |
| Developer | Register apps, view submission status |
| Student | Chat, use approved apps, no admin access |
