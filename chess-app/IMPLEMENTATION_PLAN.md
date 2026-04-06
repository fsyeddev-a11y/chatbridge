# Chess App Implementation Plan

## Goal

Build a standalone external `chess-app` that integrates cleanly with ChatBridge and supports this user flow:

1. User says "let's play chess"
2. TutorMeAI opens the chess app
3. User plays on an interactive board
4. User asks "what should I do here?" during the game
5. TutorMeAI analyzes the latest board state from Bridge-owned app context
6. The game ends
7. TutorMeAI discusses the game using final app state

## Constraints

- `chess-app` must be a true external app hosted on its own origin
- integration must rely only on the existing ChatBridge app/host contract
- the app must not assume transcript access, auth tokens, or host DOM access
- state sent to ChatBridge must be JSON-safe and compact enough for model context
- implementation should fit a lightweight static app structure similar to `weather-app`

## Phase 1: Runtime Contract And Core Game

### Outcome

Create a usable chess board app that can load in a sandboxed iframe, start a game, validate legal moves, recover state from `INIT.previousState`, and send ChatBridge lifecycle events.

### Deliverables

- static app shell:
  - `index.html`
  - `styles.css`
  - `src/bridge.js`
  - `src/main.js`
- chess engine/state module:
  - `src/chess.js`
- Bridge lifecycle support:
  - receive `INIT`, `PING`, `TERMINATE`
  - send `APP_READY`, `STATE_UPDATE`, `APP_ERROR`, `HEARTBEAT`
- interactive board UI:
  - square selection
  - move execution
  - invalid move feedback
  - new game action
  - move history

### Acceptance Criteria

- app sends `APP_READY` after successful init
- app restores from valid `previousState`
- app falls back to a fresh game on invalid recovery state
- app validates turn order and legal moves
- invalid moves do not corrupt game state
- app sends `STATE_UPDATE` after each successful move
- app responds to `PING` with `HEARTBEAT`

## Phase 2: Tutoring Context And Session Completion

### Outcome

Expand state and UX so TutorMeAI can coach the student mid-game and discuss the result after the game ends.

### Deliverables

- state summary helpers:
  - `phase`
  - `sideToMove`
  - `moveCount`
  - `lastMove`
  - `status`
  - `positionSummary`
- help-aware UI:
  - prompt telling user to ask TutorMeAI for guidance in chat
  - optional local board facts panel
- completion flows:
  - resign
  - end game
  - checkmate/stalemate detection if supported by engine
  - `APP_COMPLETE` with final result payload
- error messaging:
  - local UI banner
  - Bridge-safe `lastError` field for invalid move context when useful

### Acceptance Criteria

- TutorMeAI can infer useful advice from the latest app state
- final app payload is sufficient for post-game discussion
- completion sends a JSON-safe final state object
- state remains stable across multiple turns and reloads

## Phase 3: Hardening, Packaging, And Verification

### Outcome

Make the app easy to deploy, easy to register later, and safe to test against the ChatBridge contract.

### Deliverables

- package metadata:
  - `package.json`
  - local serve script
  - test/check scripts
- tests:
  - `test/bridge.test.js`
  - `test/chess.test.js`
  - `test/hints.test.js` if local heuristics are implemented
- docs:
  - registration manifest template
  - deployment notes
  - manual verification checklist

### Acceptance Criteria

- app can be served locally from its own origin
- tests cover lifecycle, recovery, move validation, and completion
- proposed manifest is ready to register after placeholder cleanup

## Recommended Technical Decisions

- Prefer a proven local chess rules engine over hand-rolled legality logic
- Keep the app framework-free unless implementation friction justifies otherwise
- Use FEN as the canonical serialized board state
- Keep model-facing state minimal and deterministic
- Use one ChatBridge tool for "open or resume chess" rather than separate tools for move/help

## Proposed File Layout

```text
chess-app/
  README.md
  IMPLEMENTATION_PLAN.md
  SPEC.md
  MANIFEST_AND_TESTING.md
  package.json
  index.html
  styles.css
  src/
    bridge.js
    main.js
    chess.js
    hints.js
    state-summary.js
  test/
    bridge.test.js
    chess.test.js
    hints.test.js
```

