export type RateLimitCheckResult = {
  allowed: boolean
  remaining: number
  resetAt: number
}

export type RateLimiter = {
  check(key: string): RateLimitCheckResult
}

type CounterEntry = {
  count: number
  resetAt: number
}

export function createInMemoryFixedWindowRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const counters = new Map<string, CounterEntry>()

  return {
    check(key: string) {
      const now = Date.now()
      const existing = counters.get(key)

      if (!existing || existing.resetAt <= now) {
        const resetAt = now + windowMs
        counters.set(key, { count: 1, resetAt })
        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - 1),
          resetAt,
        }
      }

      if (existing.count >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: existing.resetAt,
        }
      }

      existing.count += 1
      counters.set(key, existing)

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - existing.count),
        resetAt: existing.resetAt,
      }
    },
  }
}

export function getConfiguredChatRateLimit(
  maxRequestsValue = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_MAX_REQUESTS,
  windowMsValue = process.env.CHATBRIDGE_CHAT_RATE_LIMIT_WINDOW_MS
) {
  const parsedMaxRequests = Number(maxRequestsValue || 0)
  const parsedWindowMs = Number(windowMsValue || 60_000)

  return {
    maxRequests: Number.isFinite(parsedMaxRequests) && parsedMaxRequests > 0 ? parsedMaxRequests : 0,
    windowMs: Number.isFinite(parsedWindowMs) && parsedWindowMs > 0 ? parsedWindowMs : 60_000,
  }
}

export function createConfiguredChatRateLimiter() {
  const { maxRequests, windowMs } = getConfiguredChatRateLimit()
  if (!maxRequests) {
    return null
  }

  return createInMemoryFixedWindowRateLimiter(maxRequests, windowMs)
}
