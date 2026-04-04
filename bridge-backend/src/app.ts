import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { createSupabaseAuthVerifier, getBearerToken, type AuthVerifier } from './auth.js'
import { createOpenAIChatClient, type ChatCompletionClient } from './chat.js'
import { createConfiguredChatRateLimiterSet, type ChatRateLimiterSet, type RateLimitCheckResult, type RateLimiter } from './rate-limit.js'
import {
  AppIdParamsSchema,
  AppManifestSchema,
  AuditEventSchema,
  BackendChatRequestSchema,
  BridgeSessionUpsertBodySchema,
  ClassAllowlistBodySchema,
  ClassAllowlistToggleBodySchema,
  ClassIdParamsSchema,
  ReviewActionBodySchema,
  SessionIdParamsSchema,
} from './schemas.js'
import { createInMemoryBridgeStore, type BridgeStore } from './store.js'

export type AppOptions = {
  store?: BridgeStore
  allowedOrigins?: string[]
  authVerifier?: AuthVerifier
  chatClient?: ChatCompletionClient
  chatRateLimiter?: RateLimiter | null
  chatRateLimiterSet?: ChatRateLimiterSet
}

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:4173']

export function getConfiguredAllowedOrigins(envValue = process.env.CHATBRIDGE_ALLOWED_ORIGINS) {
  if (!envValue) {
    return DEFAULT_ALLOWED_ORIGINS
  }

  const origins = envValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return origins.length ? origins : DEFAULT_ALLOWED_ORIGINS
}

export function createApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })
  const store = options.store ?? createInMemoryBridgeStore()
  const allowedOrigins = new Set(options.allowedOrigins ?? getConfiguredAllowedOrigins())
  const authVerifier = options.authVerifier ?? createSupabaseAuthVerifier()
  const chatClient = options.chatClient ?? createOpenAIChatClient()
  const configuredRateLimiterSet = options.chatRateLimiterSet ?? createConfiguredChatRateLimiterSet()
  const chatRateLimiter = options.chatRateLimiter ?? configuredRateLimiterSet.perUser
  const chatRateLimiterSet = {
    perUser: chatRateLimiter,
    perSession: configuredRateLimiterSet.perSession,
    perIp: configuredRateLimiterSet.perIp,
  }

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
      reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    }

    if (request.method === 'OPTIONS') {
      return reply.status(204).send()
    }

    if (!request.url.startsWith('/api/')) {
      return
    }

    const token = getBearerToken(request.headers.authorization)
    if (!token) {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    const user = await authVerifier(token)
    if (!user) {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    request.headers['x-chatbridge-user-id'] = user.id
  })

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      const isOversized = error.issues.some((issue) => issue.code === 'too_big')
      await appendAbuseAuditEvent(store, {
        eventType: isOversized ? 'OversizedRequestRejected' : 'MalformedRequestRejected',
        summary: isOversized ? 'Request rejected for exceeding policy size limits.' : 'Request rejected for malformed payload.',
        metadata: {
          path: request.url,
          method: request.method,
          issues: error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join('.'),
          })),
        },
      })

      return reply.status(isOversized ? 413 : 400).send({
        error: isOversized ? 'oversized' : 'malformed',
        details: error.flatten(),
      })
    }

    return reply.status(500).send({
      error: 'internal_server_error',
    })
  })

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'bridge-backend',
    }
  })

  app.get('/api/registry/apps', async () => {
    return {
      apps: await store.listRegistryEntries(),
    }
  })

  app.get('/api/registry/apps/:appId', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const appEntry = await store.getRegistryEntry(appId)
    if (!appEntry) {
      return reply.status(404).send({
        error: 'app_not_found',
      })
    }

    return {
      app: appEntry,
    }
  })

  app.post('/api/registry/apps', async (request, reply) => {
    const manifest = AppManifestSchema.parse(request.body)
    const appEntry = await store.registerApp(manifest)
    return reply.status(201).send({
      app: appEntry,
    })
  })

  app.post('/api/registry/apps/:appId/review', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const { reviewState, reviewerId, reviewNotes } = ReviewActionBodySchema.parse(request.body)
    const updated = await store.updateReviewState(appId, reviewState, reviewerId, reviewNotes)
    if (!updated) {
      return reply.status(404).send({
        error: 'app_not_found',
      })
    }

    return {
      app: updated,
    }
  })

  app.get('/api/classes/:classId/apps', async (request) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    return {
      classId,
      apps: await store.listApprovedAppsForClass(classId),
    }
  })

  app.get('/api/classes/:classId/allowlist', async (request) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    return {
      classId,
      allowlist: await store.listClassAllowlist(classId),
    }
  })

  app.post('/api/classes/:classId/allowlist', async (request, reply) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    const { appId, enabledBy } = ClassAllowlistBodySchema.parse(request.body)
    const allowlistEntry = await store.enableAppForClass(classId, appId, enabledBy)
    if (!allowlistEntry) {
      return reply.status(404).send({
        error: 'approved_app_not_found',
      })
    }

    return reply.status(201).send({
      classId,
      allowlistEntry,
    })
  })

  app.post('/api/classes/:classId/allowlist/:appId/disable', async (request, reply) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    const { appId } = AppIdParamsSchema.parse(request.params)
    const { enabledBy } = ClassAllowlistToggleBodySchema.parse(request.body)
    const allowlistEntry = await store.disableAppForClass(classId, appId, enabledBy)
    if (!allowlistEntry) {
      return reply.status(404).send({
        error: 'allowlist_entry_not_found',
      })
    }

    return {
      classId,
      allowlistEntry,
    }
  })

  app.post('/api/audit/events', async (request, reply) => {
    const event = AuditEventSchema.parse(request.body)
    const storedEvent = await store.appendAuditEvent(event)
    return reply.status(202).send({
      accepted: true,
      event: storedEvent,
    })
  })

  app.get('/api/audit/events', async () => {
    return {
      events: await store.listAuditEvents(),
    }
  })

  app.get('/api/review-actions', async () => {
    return {
      actions: await store.listReviewActions(),
    }
  })

  app.get('/api/sessions/:sessionId/bridge-state', async (request, reply) => {
    const { sessionId } = SessionIdParamsSchema.parse(request.params)
    const userId = request.headers['x-chatbridge-user-id']

    if (typeof userId !== 'string') {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    const bridgeState = await store.getBridgeSessionState(sessionId, userId)
    return {
      sessionId,
      bridgeState,
    }
  })

  app.put('/api/sessions/:sessionId/bridge-state', async (request, reply) => {
    const { sessionId } = SessionIdParamsSchema.parse(request.params)
    const { bridgeState } = BridgeSessionUpsertBodySchema.parse(request.body)
    const userId = request.headers['x-chatbridge-user-id']

    if (typeof userId !== 'string') {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    const record = await store.upsertBridgeSessionState(sessionId, userId, bridgeState)
    return reply.status(200).send({
      sessionId,
      bridgeState: record.bridgeState,
      updatedAt: record.updatedAt,
    })
  })

  app.post('/api/chat/generate', async (request, reply) => {
    const userId = request.headers['x-chatbridge-user-id']
    const body = BackendChatRequestSchema.parse(request.body)
    const limited = await applyChatRateLimits({
      request,
      reply,
      store,
      rateLimiters: chatRateLimiterSet,
      userId: typeof userId === 'string' ? userId : undefined,
      sessionId: body.sessionId,
    })

    if (limited) {
      return limited
    }

    const response = await chatClient({
      messages: body.messages,
    })

    return reply.send(response)
  })

  return app
}

function getRequestIp(request: FastifyRequest) {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || request.ip
  }

  return request.ip
}

async function appendAbuseAuditEvent(
  store: BridgeStore,
  input: {
    eventType: string
    summary: string
    sessionId?: string
    classId?: string
    metadata?: Record<string, unknown>
  }
) {
  await store.appendAuditEvent({
    timestamp: Date.now(),
    traceId: `abuse-${Date.now()}`,
    eventType: input.eventType,
    source: 'bridge-backend',
    sessionId: input.sessionId,
    classId: input.classId,
    summary: input.summary,
    metadata: input.metadata,
  })
}

async function applyChatRateLimits(input: {
  request: FastifyRequest
  reply: FastifyReply
  store: BridgeStore
  rateLimiters: ChatRateLimiterSet
  userId?: string
  sessionId?: string
}) {
  const checks: Array<{ scope: 'user' | 'session' | 'ip'; result: RateLimitCheckResult }> = []

  if (input.rateLimiters.perUser && input.userId) {
    checks.push({
      scope: 'user',
      result: input.rateLimiters.perUser.check(`chat:user:${input.userId}`),
    })
  }

  if (input.rateLimiters.perSession && input.sessionId) {
    checks.push({
      scope: 'session',
      result: input.rateLimiters.perSession.check(`chat:session:${input.sessionId}`),
    })
  }

  const requestIp = getRequestIp(input.request)
  if (input.rateLimiters.perIp && requestIp) {
    checks.push({
      scope: 'ip',
      result: input.rateLimiters.perIp.check(`chat:ip:${requestIp}`),
    })
  }

  const firstRejected = checks.find((entry) => !entry.result.allowed)
  const primaryHeaderSource = checks[0]
  if (primaryHeaderSource) {
    input.reply.header('X-RateLimit-Remaining', String(primaryHeaderSource.result.remaining))
    input.reply.header('X-RateLimit-Reset', String(primaryHeaderSource.result.resetAt))
  }

  if (!firstRejected) {
    return null
  }

  const retryAfterMs = Math.max(0, firstRejected.result.resetAt - Date.now())
  await appendAbuseAuditEvent(input.store, {
    eventType: 'RateLimitExceeded',
    summary: `Chat generation rate limited at ${firstRejected.scope} scope.`,
    sessionId: input.sessionId,
    metadata: {
      scope: firstRejected.scope,
      retryAfterMs,
      requestIp,
      userId: input.userId,
    },
  })

  return input.reply.status(429).send({
    error: 'rate_limited',
    scope: firstRejected.scope,
    retryAfterMs,
  })
}
