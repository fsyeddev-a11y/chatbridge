import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  algebraicToSquare,
  createInitialGame,
  generateLegalMoves,
  getGameResult,
  getSerializableState,
  INITIAL_FEN,
  makeMove,
  parseFEN,
  restoreGameFromState,
  serializeFEN,
} from '../src/chess.js'
import {
  buildBridgeState,
  buildCompletionSummary,
  buildPositionSummary,
  buildStateUpdateSummary,
} from '../src/state-summary.js'

describe('chess-app engine', () => {
  it('creates the expected initial position', () => {
    const game = createInitialGame()
    assert.equal(serializeFEN(game), INITIAL_FEN)
    assert.equal(generateLegalMoves(game).length, 20)
  })

  it('allows a legal opening move and rejects an illegal pawn jump', () => {
    const game = createInitialGame()
    const legalMove = makeMove(game, algebraicToSquare('e2'), algebraicToSquare('e4'))
    assert.equal(legalMove.ok, true)
    assert.equal(legalMove.game.turn, 'b')

    const illegalMove = makeMove(legalMove.game, algebraicToSquare('e7'), algebraicToSquare('e5'))
    assert.equal(illegalMove.ok, true)

    const impossible = makeMove(illegalMove.game, algebraicToSquare('e4'), algebraicToSquare('e6'))
    assert.equal(impossible.ok, false)
  })

  it('tracks en passant targets in FEN after a double pawn push', () => {
    const game = createInitialGame()
    const moved = makeMove(game, algebraicToSquare('e2'), algebraicToSquare('e4'))
    assert.equal(moved.ok, true)
    assert.match(serializeFEN(moved.game), /\sb\sKQkq\se3\s/)
  })

  it('restores a serialized position with move history', () => {
    const game = createInitialGame()
    const one = makeMove(game, algebraicToSquare('e2'), algebraicToSquare('e4')).game
    const two = makeMove(one, algebraicToSquare('e7'), algebraicToSquare('e5')).game
    const state = getSerializableState(two)
    const restored = restoreGameFromState(state)

    assert.equal(serializeFEN(restored), state.fen)
    assert.equal(restored.history.length, 2)
  })

  it('detects checkmate in Fool’s Mate', () => {
    const game = parseFEN('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')
    const result = getGameResult(game)

    assert.equal(result.status, 'complete')
    assert.equal(result.result, 'black_win')
    assert.equal(result.terminationReason, 'checkmate')
  })

  it('treats a missing king as an immediate completed game', () => {
    const game = parseFEN('rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1')
    const result = getGameResult(game)

    assert.equal(result.status, 'complete')
    assert.equal(result.result, 'white_win')
    assert.equal(result.terminationReason, 'king_captured')
  })
})

describe('chess-app summaries', () => {
  it('builds bridge-safe summaries for active play', () => {
    const game = createInitialGame()
    const move = makeMove(game, algebraicToSquare('e2'), algebraicToSquare('e4')).game
    const state = buildBridgeState(getSerializableState(move))

    assert.equal(state.sideToMove, 'black')
    assert.equal(state.lastMove, 'e2e4')
    assert.match(buildPositionSummary(state), /Black to move/)
    assert.match(buildStateUpdateSummary(state), /Last move e2e4/)
  })

  it('builds completion summaries for final states', () => {
    const finalState = buildBridgeState({
      fen: 'final',
      phase: 'endgame',
      sideToMove: 'black',
      moveCount: 34,
      lastMove: 'h5h7',
      status: 'complete',
      result: 'white_win',
      winner: 'white',
      terminationReason: 'checkmate',
      lastError: null,
      moveHistory: [],
      capturedWhite: [],
      capturedBlack: [],
      check: true,
      checkmate: true,
      stalemate: false,
      playerColor: 'white',
    })

    assert.equal(buildCompletionSummary(finalState), 'White won by checkmate after 34 moves.')
  })
})
