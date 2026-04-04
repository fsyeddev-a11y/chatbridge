export type RateLimitCheckResult = {
  allowed: boolean
  remaining: number
  resetAt: number
}

export type RateLimiter = {
  check(key: string): RateLimitCheckResult
}

export type ChatRateLimiterSet = {
  perUser: RateLimiter | null
  perSession: RateLimiter | null
  perIp: RateLimiter | null
}

export type MutationRateLimiterSet = {
  perUser: RateLimiter | null
}

export type ToolRateLimiterSet = {
  perUserPerApp: RateLimiter | null
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

function getConfiguredNamedRateLimit(
  maxRequestsValue: string | undefined,
  windowMsValue: string | undefined,
  fallbackWindowMs = 60_000
) {
  const parsedMaxRequests = Number(maxRequestsValue || 0)
  const parsedWindowMs = Number(windowMsValue || fallbackWindowMs)

  return {
    maxRequests: Number.isFinite(parsedMaxRequests) && parsedMaxRequests > 0 ? parsedMaxRequests : 0,
    windowMs: Number.isFinite(parsedWindowMs) && parsedWindowMs > 0 ? parsedWindowMs : fallbackWindowMs,
  }
}

export function getConfiguredMutationRateLimit(
  maxRequestsValue = process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_MAX_REQUESTS,
  windowMsValue = process.env.CHATBRIDGE_MUTATION_RATE_LIMIT_WINDOW_MS
) {
  return getConfiguredNamedRateLimit(maxRequestsValue, windowMsValue)
}

export function getConfiguredChatRateLimiterSet(env = process.env): {
  perUser: { maxRequests: number; windowMs: number }
  perSession: { maxRequests: number; windowMs: number }
  perIp: { maxRequests: number; windowMs: number }
} {
  const legacy = getConfiguredChatRateLimit(
    env.CHATBRIDGE_CHAT_RATE_LIMIT_MAX_REQUESTS,
    env.CHATBRIDGE_CHAT_RATE_LIMIT_WINDOW_MS
  )

  return {
    perUser: getConfiguredNamedRateLimit(
      env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_MAX_REQUESTS ?? (legacy.maxRequests ? String(legacy.maxRequests) : undefined),
      env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_USER_WINDOW_MS ?? (legacy.maxRequests ? String(legacy.windowMs) : undefined)
    ),
    perSession: getConfiguredNamedRateLimit(
      env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_MAX_REQUESTS,
      env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_SESSION_WINDOW_MS
    ),
    perIp: getConfiguredNamedRateLimit(
      env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_MAX_REQUESTS,
      env.CHATBRIDGE_CHAT_RATE_LIMIT_PER_IP_WINDOW_MS
    ),
  }
}

export function createConfiguredChatRateLimiterSet(): ChatRateLimiterSet {
  const configured = getConfiguredChatRateLimiterSet()

  return {
    perUser: configured.perUser.maxRequests
      ? createInMemoryFixedWindowRateLimiter(configured.perUser.maxRequests, configured.perUser.windowMs)
      : null,
    perSession: configured.perSession.maxRequests
      ? createInMemoryFixedWindowRateLimiter(configured.perSession.maxRequests, configured.perSession.windowMs)
      : null,
    perIp: configured.perIp.maxRequests
      ? createInMemoryFixedWindowRateLimiter(configured.perIp.maxRequests, configured.perIp.windowMs)
      : null,
  }
}

export function createConfiguredMutationRateLimiterSet(): MutationRateLimiterSet {
  const configured = getConfiguredMutationRateLimit()

  return {
    perUser: configured.maxRequests
      ? createInMemoryFixedWindowRateLimiter(configured.maxRequests, configured.windowMs)
      : null,
  }
}

export function getConfiguredToolRateLimit(
  maxRequestsValue = process.env.CHATBRIDGE_TOOL_RATE_LIMIT_MAX_REQUESTS,
  windowMsValue = process.env.CHATBRIDGE_TOOL_RATE_LIMIT_WINDOW_MS
) {
  return getConfiguredNamedRateLimit(maxRequestsValue, windowMsValue)
}

export function createConfiguredToolRateLimiterSet(): ToolRateLimiterSet {
  const configured = getConfiguredToolRateLimit()

  return {
    perUserPerApp: configured.maxRequests
      ? createInMemoryFixedWindowRateLimiter(configured.maxRequests, configured.windowMs)
      : null,
  }
}
