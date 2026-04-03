# ChatBridge Weather App

This is the first real external ChatBridge app. It is a plain static web app that:

- receives `INIT`, `PING`, and `TERMINATE` from the ChatBridge host
- sends `APP_READY`, `STATE_UPDATE`, `APP_COMPLETE`, `APP_ERROR`, and `HEARTBEAT`
- fetches live weather data from Open-Meteo without an API key

## Run locally

```bash
cd /Users/fsyed/Documents/ChatBridge/weather-app
pnpm test
pnpm check
pnpm serve
```

Then open:

- `http://localhost:4173`

## Expected ChatBridge manifest values

- `launchUrl`: `http://localhost:4173`
- `allowedOrigins`: `["http://localhost:4173"]`
- `heartbeatTimeoutMs`: `10000`

## Notes

- The app uses Open-Meteo geocoding plus forecast endpoints.
- The Bridge remains the authority on what state is stored or exposed to the model.
