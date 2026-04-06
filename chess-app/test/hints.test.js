import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildBoardFacts, buildHint } from '../src/hints.js'

describe('chess-app hints', () => {
  it('prefers opening guidance early in the game', () => {
    const hint = buildHint({
      phase: 'opening',
      moveCount: 1,
      sideToMove: 'white',
      capturedWhite: [],
      capturedBlack: [],
      check: false,
    })

    assert.match(hint, /center|knight|develop/i)
  })

  it('returns emergency guidance when the king is in check', () => {
    const hint = buildHint({
      phase: 'middlegame',
      moveCount: 18,
      sideToMove: 'black',
      capturedWhite: [],
      capturedBlack: [],
      check: true,
    })

    assert.match(hint, /check/i)
  })

  it('builds compact board facts for the UI', () => {
    const facts = buildBoardFacts({
      phase: 'endgame',
      moveCount: 31,
      sideToMove: 'white',
      lastMove: 'e7e8q',
      capturedWhite: ['p'],
      capturedBlack: ['q'],
      check: false,
    })

    assert.equal(facts.phase, 'endgame')
    assert.equal(facts.moveCount, 31)
    assert.equal(facts.lastMove, 'e7e8q')
    assert.equal(typeof facts.hint, 'string')
  })
})
