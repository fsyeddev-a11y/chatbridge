import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createConfiguredChatRateLimiter, createInMemoryFixedWindowRateLimiter, getConfiguredChatRateLimit } from '../src/rate-limit.js'

describe('bridge-backend rate limiting', () => {
  it('applies a fixed-window limit per key', () => {
    const limiter = createInMemoryFixedWindowRateLimiter(2, 60_000)

    const first = limiter.check('chat:user-1')
    const second = limiter.check('chat:user-1')
    const third = limiter.check('chat:user-1')

    assert.equal(first.allowed, true)
    assert.equal(second.allowed, true)
    assert.equal(third.allowed, false)
    assert.equal(third.remaining, 0)
  })

  it('parses configured chat rate limit env safely', () => {
    assert.deepEqual(getConfiguredChatRateLimit(undefined, undefined), {
      maxRequests: 0,
      windowMs: 60_000,
    })
    assert.deepEqual(getConfiguredChatRateLimit('5', '30000'), {
      maxRequests: 5,
      windowMs: 30000,
    })
    assert.deepEqual(getConfiguredChatRateLimit('bad', 'also-bad'), {
      maxRequests: 0,
      windowMs: 60_000,
    })
  })

  it('returns null when rate limiting is disabled by config', () => {
    const originalMax = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_MAX_REQUESTS
    const originalWindow = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_WINDOW_MS

    delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_MAX_REQUESTS
    delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_WINDOW_MS

    try {
      assert.equal(createConfiguredChatRateLimiter(), null)
    } finally {
      if (originalMax === undefined) {
        delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_MAX_REQUESTS
      } else {
        process.env.CHATBRIDGE_CHAT_RATE_LIMIT_MAX_REQUESTS = originalMax
      }

      if (originalWindow === undefined) {
        delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_WINDOW_MS
      } else {
        process.env.CHATBRIDGE_CHAT_RATE_LIMIT_WINDOW_MS = originalWindow
      }
    }
  })
})
