import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getBearerToken } from '../src/auth.js'

describe('bridge-backend auth helpers', () => {
  it('extracts bearer tokens safely', () => {
    assert.equal(getBearerToken(undefined), null)
    assert.equal(getBearerToken('Basic abc123'), null)
    assert.equal(getBearerToken('Bearer token-123'), 'token-123')
  })
})
