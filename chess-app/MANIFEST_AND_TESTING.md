# Chess App Manifest And Testing Spec

## Proposed Manifest For Later Registration

This manifest is not being registered now. It is the target shape for the new external app after the placeholder chess integration is removed.

```json
{
  "appId": "chess-app",
  "name": "Chess Coach",
  "version": "1.0.0",
  "description": "Interactive chess board with legal move validation and TutorMeAI coaching support.",
  "developerName": "ChatBridge Demo",
  "executionModel": "iframe",
  "launchUrl": "https://your-chess-app-domain",
  "allowedOrigins": ["https://your-chess-app-domain"],
  "heartbeatTimeoutMs": 10000,
  "authType": "none",
  "subjectTags": ["Strategy", "Logic"],
  "gradeBand": "3-12",
  "llmSafeFields": [
    "fen",
    "phase",
    "sideToMove",
    "moveCount",
    "lastMove",
    "status",
    "result",
    "winner",
    "terminationReason",
    "positionSummary",
    "lastError"
  ],
  "tools": [
    {
      "name": "chatbridge_chess_open",
      "description": "Open or resume the chess coaching app for the current student."
    }
  ]
}
```

## Why A Single Tool

Use one tool to open or resume the app.

Reasoning:

- once the board is open, all game interaction should happen inside the iframe
- mid-game help should happen through normal TutorMeAI chat turns using Bridge state
- splitting into multiple tools like `start_game` and `get_hint` adds complexity without improving the user flow

## Event Examples

### APP_READY

```json
{
  "source": "chatbridge-app",
  "version": "1.0",
  "appId": "chess-app",
  "type": "APP_READY",
  "payload": {
    "summary": "Chess Coach is ready. New game loaded."
  }
}
```

### STATE_UPDATE After A Move

```json
{
  "source": "chatbridge-app",
  "version": "1.0",
  "appId": "chess-app",
  "type": "STATE_UPDATE",
  "payload": {
    "summary": "Opening position after 1. e4. Black to move.",
    "state": {
      "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b",
      "phase": "opening",
      "sideToMove": "black",
      "moveCount": 1,
      "lastMove": "e2e4",
      "status": "in_progress",
      "result": null,
      "winner": null,
      "terminationReason": null,
      "positionSummary": "Opening position after 1. e4. Black to move.",
      "lastError": null
    }
  }
}
```

### APP_COMPLETE

```json
{
  "source": "chatbridge-app",
  "version": "1.0",
  "appId": "chess-app",
  "type": "APP_COMPLETE",
  "payload": {
    "summary": "White won by checkmate after 34 moves.",
    "state": {
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
  }
}
```

## Test Matrix

### Contract Tests

- valid `INIT` creates or restores a game
- `PING` yields `HEARTBEAT`
- `TERMINATE` stops interaction cleanly
- `APP_READY` uses the correct envelope shape
- `STATE_UPDATE` always sends an object payload
- `APP_COMPLETE` always sends an object payload

### Chess Logic Tests

- initial position is correct
- legal pawn, knight, bishop, rook, queen, and king moves work
- illegal moves are rejected
- turn order is enforced
- capture behavior is correct
- terminal states are detected if supported by engine
- FEN serialization/deserialization is stable

### Recovery Tests

- valid `previousState` restores the board
- missing `previousState` starts a new game
- malformed `previousState` does not crash the app
- restored state still allows valid subsequent moves

### UX Tests

- invalid move banner appears and clears correctly
- move history updates after valid moves
- new game resets state
- end session triggers completion flow

## Manual Verification Checklist

1. Serve `chess-app` locally on its own origin
2. Load it in a plain browser and verify it can initialize its own UI
3. Simulate host `INIT`
4. Verify `APP_READY`
5. Make several legal moves and inspect emitted `STATE_UPDATE` payloads
6. Attempt illegal moves and confirm board state does not change
7. Simulate page reload with previous state and verify recovery
8. Complete or resign the game and verify `APP_COMPLETE`
9. Confirm the final payload is compact enough for Bridge-owned summary use

