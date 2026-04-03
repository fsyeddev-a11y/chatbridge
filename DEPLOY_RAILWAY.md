# Railway Deployment

Recommended Railway services:
- `chatbox-web`: static frontend build from `chatbox`
- `bridge-backend`: always-on Node service from `bridge-backend`
- `weather-app`: lightweight static app from `weather-app`
- future services: `chess-app`, `story-builder`, `google-classroom-app`
- `postgres`: managed Railway Postgres when backend persistence moves off the file store

## 1. `bridge-backend`

Root directory:
- `bridge-backend`

Build command:
```bash
pnpm install --frozen-lockfile && pnpm build
```

Start command:
```bash
pnpm start
```

Environment variables:
- `HOST=0.0.0.0`
- `PORT` is provided by Railway
- `CHATBRIDGE_STORE_PATH=/data/bridge-store.json`
- `CHATBRIDGE_ALLOWED_ORIGINS=https://your-chatbox-domain.railway.app,https://your-weather-domain.railway.app`
- `CHATBRIDGE_WEATHER_APP_URL=https://your-weather-domain.railway.app`

## 2. `chatbox-web`

Root directory:
- `chatbox`

Build command:
```bash
pnpm install --frozen-lockfile && pnpm run build:web
```

Static publish directory:
- `release/app/dist/renderer`

Build-time environment variables:
- `CHATBRIDGE_API_ORIGIN=https://your-bridge-backend-domain.railway.app`
- `CHATBRIDGE_WEATHER_APP_URL=https://your-weather-domain.railway.app`

SPA behavior:
- configure Railway static hosting to serve the built directory
- add a rewrite/fallback so deep links like `/session/<id>` resolve to `index.html`

## 3. `weather-app`

Root directory:
- `weather-app`

Option A: Railway static hosting
- publish `weather-app/` as a static site

Option B: Railway service
- Build command: none
- Start command:
```bash
pnpm run serve
```

Notes:
- `pnpm run serve` now respects Railway's `PORT`
- no secrets are required for Open-Meteo

## 4. Domain wiring

Recommended order:
1. deploy `weather-app`
2. deploy `bridge-backend` with `CHATBRIDGE_WEATHER_APP_URL` pointing at the deployed weather domain
3. deploy `chatbox-web` with `CHATBRIDGE_API_ORIGIN` and `CHATBRIDGE_WEATHER_APP_URL`
4. update `CHATBRIDGE_ALLOWED_ORIGINS` on the backend if Railway assigns or changes frontend/app domains

## 5. Current production-sensitive values

These are environment-driven now:
- backend CORS allowlist
- backend-seeded Weather app `launchUrl`
- frontend fallback Weather app `launchUrl`
- frontend Bridge API origin

That means we can move from localhost to Railway domains without editing source code again.
