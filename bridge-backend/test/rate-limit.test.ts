import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createConfiguredChatRateLimiter,
  createConfiguredChatRateLimiterSet,
  createConfiguredMutationRateLimiterSet,
  createInMemoryFixedWindowRateLimiter,
  getConfiguredChatRateLimit,
  getConfiguredChatRateLimiterSet,
  getConfiguredMutationRateLimit,
} from '../src/rate-limit.js'

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

  it('parses multi-scope chat rate limit env safely', () => {
    assert.deepEqual(
      getConfiguredChatRateLimiterSet({
        CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS: '4',
        CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_WINDOW_MS: '45000',
        CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS: '2',
        CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_WINDOW_MS: '30000',
        CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_MAX_REQUESTS: '8',
        CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_WINDOW_MS: '60000',
      } as NodeJS.ProcessEnv),
      {
        perUser: { maxRequests: 4, windowMs: 45000 },
        perSession: { maxRequests: 2, windowMs: 30000 },
        perIp: { maxRequests: 8, windowMs: 60000 },
      }
    )
  })

  it('creates only the configured multi-scope rate limiters', () => {
    const originalUserMax = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS
    const originalUserWindow = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_WINDOW_MS
    const originalSessionMax = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS
    const originalIpMax = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_MAX_REQUESTS
    process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS = '3'
    process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_WINDOW_MS = '60000'
    delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS
    delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_MAX_REQUESTS

    try {
      const limiterSet = createConfiguredChatRateLimiterSet()
      assert.ok(limiterSet.perUser)
      assert.equal(limiterSet.perSession, null)
      assert.equal(limiterSet.perIp, null)
    } finally {
      if (originalUserMax === undefined) delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS
      else process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS = originalUserMax
      if (originalUserWindow === undefined) delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_WINDOW_MS
      else process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_WINDOW_MS = originalUserWindow
      if (originalSessionMax === undefined) delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS
      else process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS = originalSessionMax
      if (originalIpMax === undefined) delete process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_MAX_REQUESTS
      else process.env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_MAX_REQUESTS = originalIpMax
    }
  })

  it('parses mutation rate limit env safely', () => {
    assert.deepEqual(getConfiguredMutationRateLimit(undefined, undefined), {
      maxRequests: 0,
      windowMs: 60_000,
    })
    assert.deepEqual(getConfiguredMutationRateLimit('6', '45000'), {
      maxRequests: 6,
      windowMs: 45000,
    })
  })

  it('creates a mutation rate limiter only when configured', () => {
    const originalMax = process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_MAX_REQUESTS
    const originalWindow = process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_WINDOW_MS

    process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_MAX_REQUESTS = '2'
    process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_WINDOW_MS = '30000'

    try {
      const limiterSet = createConfiguredMutationRateLimiterSet()
      assert.ok(limiterSet.perUser)
    } finally {
      if (originalMax === undefined) delete process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_MAX_REQUESTS
      else process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_MAX_REQUESTS = originalMax
      if (originalWindow === undefined) delete process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_WINDOW_MS
      else process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_WINDOW_MS = originalWindow
    }
  })
})
