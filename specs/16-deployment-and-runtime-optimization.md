# Epic 16: Deployment & Runtime Optimization

## Dependencies

- Depends on: none
- Informs: all deployable epics

## Status

- Implemented now:
  - standalone web build skips Electron `main` and `preload`
  - standalone web build no longer requires Chatbox cloud startup dependencies
- Not implemented yet:
  - service-specific deploy triggers
  - smaller dependency/install footprint
  - systematic bundle-size governance

## Context

The current Chatbox-derived web deployment works, but it is still heavier than a purpose-built TutorMeAI frontend should be. The build path has already been improved to skip Electron `main` and `preload` for web, but deploy speed, bundle size, and service isolation still need formal optimization requirements.

---

## User Stories

### US-16.1: Web deploys build only what the web app needs

**As a** platform engineer,  
**I want** `chatbox-web` deploys to build only web artifacts,  
**so that** deploy times and build costs are reduced.

#### Acceptance Criteria

- Web deploys skip Electron `main` and `preload`.
- The output remains `release/app/dist/renderer`.
- Railway can keep using the same deployment target path.

#### Testing

- Build verification confirms only the renderer is built for web.
- Deployment verification confirms the hosted app still works after the optimization.

#### Spec

**Current optimized web path:**

```
CHATBOX_BUILD_PLATFORM=web
  -> build renderer only
  -> output release/app/dist/renderer
  -> deploy as web service
```

---

### US-16.2: Monorepo services do not rebuild unnecessarily

**As a** platform engineer,  
**I want** changes in one service to avoid triggering needless rebuilds in unrelated services,  
**so that** iteration is faster and cheaper.

#### Acceptance Criteria

- `chatbox-web`, `bridge-backend`, and `weather-app` can be deployed independently.
- Service-specific deploy triggers or watch paths are documented/configured where possible.

#### Testing

- Manual deployment checks verify changes to one service do not unnecessarily redeploy all others when configuration supports isolation.

#### Spec

**Target service isolation:**

```
chatbox-web
  watches chatbox/

bridge-backend
  watches bridge-backend/

weather-app
  watches weather-app/
```

---

### US-16.3: Frontend bundle size is reduced over time

**As a** platform engineer,  
**I want** the web bundle to get smaller and more targeted,  
**so that** load times and build times improve.

#### Acceptance Criteria

- Large chunks are identified and tracked.
- Opportunities for route splitting and unused desktop dependency removal are documented.
- Bundle size regressions can be measured over time.

#### Testing

- Build artifact inspection tracks large chunks and regressions.
- Optional bundle analyzer output is retained for review.

#### Spec

**Optimization priorities:**

1. remove unnecessary desktop dependencies from web deploy path
2. reduce install/build time
3. reduce initial JS payload
4. preserve current UX and trust boundaries

---

### US-16.4: The deployment model remains compatible with the final architecture

**As a** product owner,  
**I want** deployment optimizations to remain compatible with a frontend + Node backend + external apps architecture,  
**so that** short-term speed improvements do not fight the long-term system design.

#### Acceptance Criteria

- Frontend deployment remains separate from `bridge-backend`.
- External apps remain deployable as independent services.
- Optimization work does not push secrets or backend logic into the browser.

#### Testing

- Architecture review confirms optimizations preserve the intended trust boundaries.

## Out of Scope

- collapsing frontend and backend into one service
- moving secrets into the frontend bundle
- changing the architectural split of external apps as independent services
