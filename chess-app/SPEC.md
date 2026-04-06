# Chess App Spec

## 1. Product Summary

`chess-app` is a third-party educational chess board embedded inside TutorMeAI through ChatBridge. The app owns the board UI and chess legality. TutorMeAI owns the conversation, coaching, and post-game reflection.

The app must support:
- starting a new game
- moving pieces on an interactive board
- legal move validation
- invalid move feedback
- long-lived game state
- recovery after reload via `previousState`
- clean end-of-game signaling to ChatBridge

## 2. User Experience

### Primary Flow

1. User asks TutorMeAI to play chess
2. TutorMeAI opens `chess-app`
3. App receives `INIT`
4. App displays a board and sends `APP_READY`
5. User makes moves in the app
6. App sends `STATE_UPDATE` after each valid move
7. User asks TutorMeAI "what should I do here?"
8. TutorMeAI reads Bridge-owned chess context and replies in chat
9. App completes the session through normal game termination or explicit end action
10. App sends `APP_COMPLETE`
11. TutorMeAI discusses the final position and game result

### UI Requirements

- 8x8 interactive chess board
- clear indication of selected square
- legal move feedback
- invalid move error banner
- move history panel
- side-to-move indicator
- status banner for Bridge lifecycle state
- controls:
  - `New Game`
  - `Resign`
  - `End Session`

### Chat Guidance UX

The app should explicitly tell the student that strategic help comes from TutorMeAI in chat. The app can show local board facts, but the main coaching response should come from the chatbot.

Suggested copy:

`Need help with this position? Ask TutorMeAI in chat: "what should I do here?"`

## 3. Integration Contract

### Host To App Messages

The app must handle:

- `INIT`
- `PING`
- `TERMINATE`

Expected `INIT` payload fields:

- `sessionId`
- `classId`
- `locale`
- `theme`
- `previousState`

The app must treat `previousState` as optional and untrusted.

### App To Host Messages

The app must send:

- `APP_READY`
- `STATE_UPDATE`
- `APP_COMPLETE`
- `APP_ERROR`
- `HEARTBEAT`

### Event Rules

- `APP_READY`:
  sent after successful startup and board initialization
- `STATE_UPDATE`:
  sent after each valid move and after any meaningful app state change
- `APP_COMPLETE`:
  sent when the game is finished or the user explicitly ends the session
- `APP_ERROR`:
  sent only for true runtime/recovery failures, not for ordinary invalid moves
- `HEARTBEAT`:
  sent in response to `PING`

## 4. State Model

### Canonical State

The app should maintain canonical board state using FEN plus derived metadata.

Recommended state shape:

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w",
  "phase": "opening",
  "sideToMove": "white",
  "moveCount": 0,
  "lastMove": null,
  "status": "in_progress",
  "result": null,
  "winner": null,
  "terminationReason": null,
  "positionSummary": "New game. White to move.",
  "lastError": null,
  "capturedWhite": [],
  "capturedBlack": [],
  "playerColor": "white"
}
```

### Required Bridge-Safe Fields

These fields should be planned as `llmSafeFields` when the app is later registered:

- `fen`
- `phase`
- `sideToMove`
- `moveCount`
- `lastMove`
- `status`
- `result`
- `winner`
- `terminationReason`
- `positionSummary`
- `lastError`

### Recovery Rules

On `INIT`:

- if `previousState` is valid, restore board/session state
- if invalid, start a fresh game and continue
- if recovery fails unexpectedly, send `APP_ERROR` and fall back safely

## 5. Legal Move Validation

This requirement is mandatory. The app must prevent illegal moves from mutating canonical state.

Recommended approach:

- use a proven local chess rules engine
- use its move legality, FEN serialization, and terminal-state detection

Why:

- check/checkmate/stalemate logic is error-prone to implement manually
- move legality needs to be trustworthy for tutoring quality
- FEN-based state recovery becomes much simpler

## 6. Invalid Move Behavior

Invalid moves are normal product behavior, not fatal app errors.

Required behavior:

- do not mutate board state
- show a clear in-app error message
- keep the board interactive

Optional Bridge behavior:

- include a non-fatal `lastError` field in the next `STATE_UPDATE` if the product wants TutorMeAI aware of repeated move issues

Do not use `APP_ERROR` for ordinary illegal moves.

## 7. Mid-Game Help Model

The app does not need a special host message for help requests. Mid-game help should work through normal chat.

Flow:

1. user plays moves in the app
2. app sends `STATE_UPDATE`
3. user asks in chat "what should I do here?"
4. TutorMeAI reads latest chess state from Bridge context
5. TutorMeAI answers in chat using the current position

This avoids protocol changes and still satisfies the required user experience.

## 8. Completion Model

The app should send `APP_COMPLETE` when:

- checkmate
- stalemate
- resignation
- explicit end-session action

Recommended final payload:

```json
{
  "fen": "final-position",
  "phase": "endgame",
  "sideToMove": "black",
  "moveCount": 34,
  "lastMove": "Qh7#",
  "status": "complete",
  "result": "white_win",
  "winner": "white",
  "terminationReason": "checkmate",
  "positionSummary": "White won by checkmate after 34 moves.",
  "lastError": null
}
```

This is enough for TutorMeAI to discuss the outcome after the game ends.

## 9. Non-Goals For V1

- direct transcript access
- app-owned chatbot responses
- multiplayer networking
- clocks and timed play
- account systems
- arbitrary custom host messages

