import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getAILevelConfig } from '../src/ai.js'

describe('chess-app AI config', () => {
  it('returns increasing search settings for higher difficulties', () => {
    const easy = getAILevelConfig('easy')
    const medium = getAILevelConfig('medium')
    const hard = getAILevelConfig('hard')

    assert.ok(easy.depth < medium.depth)
    assert.ok(medium.depth < hard.depth)
    assert.ok(easy.skill < medium.skill)
    assert.ok(medium.skill < hard.skill)
  })

  it('falls back to easy for unknown values', () => {
    const fallback = getAILevelConfig('unknown')
    assert.equal(fallback.label, 'Easy AI')
  })
})
