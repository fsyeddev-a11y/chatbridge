import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { createSupabaseAuthVerifier, getBearerToken, type AuthVerifier } from './auth.js'
import {
  createOpenAIChatClient,
  createOpenAIChatStreamClient,
  type ChatCompletionClient,
  type ChatCompletionStreamClient,
} from './chat.js'
import { prependChatBridgeOrchestrationMessage } from './chatbridge-orchestration.js'
import { ChatBridgeToolPolicyError, createChatBridgeToolDefinitions } from './chatbridge-tools.js'
import {
  createConfiguredChatRateLimiterSet,
  createConfiguredMutationRateLimiterSet,
  createConfiguredToolRateLimiterSet,
  type ChatRateLimiterSet,
  type MutationRateLimiterSet,
  type RateLimitCheckResult,
  type RateLimiter,
  type ToolRateLimiterSet,
} from './rate-limit.js'
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
  chatStreamClient?: ChatCompletionStreamClient
  chatRateLimiter?: RateLimiter | null
  chatRateLimiterSet?: ChatRateLimiterSet
  mutationRateLimiterSet?: MutationRateLimiterSet
  toolRateLimiterSet?: ToolRateLimiterSet
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
  const chatStreamClient = options.chatStreamClient ?? createOpenAIChatStreamClient()
  const configuredRateLimiterSet = options.chatRateLimiterSet ?? createConfiguredChatRateLimiterSet()
  const chatRateLimiter = options.chatRateLimiter ?? configuredRateLimiterSet.perUser
  const chatRateLimiterSet = {
    perUser: chatRateLimiter,
    perSession: configuredRateLimiterSet.perSession,
    perIp: configuredRateLimiterSet.perIp,
  }
  const mutationRateLimiterSet = options.mutationRateLimiterSet ?? createConfiguredMutationRateLimiterSet()
  const toolRateLimiterSet = options.toolRateLimiterSet ?? createConfiguredToolRateLimiterSet()

  async function prepareChatInvocation(body: {
    sessionId?: string
    classId?: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  }, userId?: string) {
    const bridgeState = body.sessionId && userId ? await store.getBridgeSessionState(body.sessionId, userId) : undefined
    const effectiveClassId = body.classId || bridgeState?.activeClassId
    const approvedApps = effectiveClassId ? await store.listApprovedAppsForClass(effectiveClassId) : []
    const traceId = `model-${randomUUID()}`
    const orchestratedMessages = prependChatBridgeOrchestrationMessage(body.messages, {
      classId: effectiveClassId,
      approvedApps,
      bridgeState,
    })
    const toolDefinitions = await createChatBridgeToolDefinitions({
      approvedApps,
      store,
      sessionId: body.sessionId,
      userId,
      classId: effectiveClassId,
      bridgeState,
      traceId,
      toolRateLimiter: toolRateLimiterSet.perUserPerApp,
    })

    return {
      bridgeState,
      effectiveClassId,
      approvedApps,
      traceId,
      orchestratedMessages,
      toolDefinitions,
    }
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
    if (user.email) {
      request.headers['x-chatbridge-user-email'] = user.email
    }
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

  app.get('/api/developer/apps', async (request, reply) => {
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    return {
      apps: await store.listRegistryEntriesForOwner(userId),
    }
  })

  app.get('/api/developer/review-actions', async (request, reply) => {
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    return {
      actions: await store.listReviewActionsForOwner(userId),
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
    const limited = await applyMutationRateLimit({
      request,
      reply,
      store,
      rateLimiterSet: mutationRateLimiterSet,
      scope: 'registry_register',
    })
    if (limited) {
      return limited
    }

    const manifest = AppManifestSchema.parse(request.body)
    const userId = request.headers['x-chatbridge-user-id']
    const userEmail = request.headers['x-chatbridge-user-email']
    const appEntry = await store.registerApp(
      manifest,
      typeof userId === 'string'
        ? {
            userId,
            email: typeof userEmail === 'string' ? userEmail : undefined,
          }
        : undefined
    )
    return reply.status(201).send({
      app: appEntry,
    })
  })

  app.post('/api/registry/apps/:appId/review', async (request, reply) => {
    const limited = await applyMutationRateLimit({
      request,
      reply,
      store,
      rateLimiterSet: mutationRateLimiterSet,
      scope: 'registry_review',
    })
    if (limited) {
      return limited
    }

    const { appId } = AppIdParamsSchema.parse(request.params)
    const { reviewState, reviewerId, reviewNotes, version } = ReviewActionBodySchema.parse(request.body)
    const updated = await store.updateReviewState(appId, reviewState, reviewerId, reviewNotes, version)
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
    const limited = await applyMutationRateLimit({
      request,
      reply,
      store,
      rateLimiterSet: mutationRateLimiterSet,
      scope: 'class_allowlist_enable',
    })
    if (limited) {
      return limited
    }

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
    const limited = await applyMutationRateLimit({
      request,
      reply,
      store,
      rateLimiterSet: mutationRateLimiterSet,
      scope: 'class_allowlist_disable',
    })
    if (limited) {
      return limited
    }

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
    const limited = await applyMutationRateLimit({
      request,
      reply,
      store,
      rateLimiterSet: mutationRateLimiterSet,
      scope: 'bridge_state_upsert',
    })
    if (limited) {
      return limited
    }

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

  app.post('/api/chat/stream', async (request, reply) => {
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

    const authenticatedUserId = typeof userId === 'string' ? userId : undefined
    const { bridgeState, effectiveClassId, approvedApps, traceId, orchestratedMessages, toolDefinitions } =
      await prepareChatInvocation(body, authenticatedUserId)
    const abortController = new AbortController()
    request.raw.on('close', () => {
      abortController.abort()
    })

    await store.appendAuditEvent({
      timestamp: Date.now(),
      traceId,
      eventType: 'ModelInvocationStarted',
      source: 'bridge-backend',
      sessionId: body.sessionId,
      classId: effectiveClassId,
      appId: bridgeState?.activeAppId,
      summary: 'Backend-owned streaming model invocation started.',
      metadata: {
        model: process.env.CHATBRIDGE_OPENAI_MODEL || 'gpt-4o-mini',
        messageCount: body.messages.length,
        approvedAppCount: approvedApps.length,
        transport: 'sse',
      },
    })

    reply.hijack()
    const existingHeaders = reply.getHeaders()
    for (const [name, value] of Object.entries(existingHeaders)) {
      if (value !== undefined) {
        reply.raw.setHeader(name, value as string | number | readonly string[])
      }
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.writeHead(200)

    const writeEvent = (event: string, data: Record<string, unknown>) => {
      reply.raw.write(`event: ${event}\n`)
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      writeEvent('started', {
        traceId,
        model: process.env.CHATBRIDGE_OPENAI_MODEL || 'gpt-4o-mini',
      })

      const response = await chatStreamClient(
        {
          messages: orchestratedMessages,
          tools: toolDefinitions,
          signal: abortController.signal,
        },
        {
          onTextDelta: (delta) => {
            writeEvent('delta', { delta })
          },
          onToolResult: (toolResult) => {
            writeEvent('tool_result', { toolResult })
          },
        }
      )

      const updatedBridgeState =
        body.sessionId && authenticatedUserId ? await store.getBridgeSessionState(body.sessionId, authenticatedUserId) : undefined

      await store.appendAuditEvent({
        timestamp: Date.now(),
        traceId,
        eventType: 'ModelInvocationCompleted',
        source: 'bridge-backend',
        sessionId: body.sessionId,
        classId: effectiveClassId,
        appId: updatedBridgeState?.activeAppId || bridgeState?.activeAppId,
        summary: 'Backend-owned streaming model invocation completed.',
        metadata: {
          model: response.model,
          approvedAppCount: approvedApps.length,
          activeAppId: updatedBridgeState?.activeAppId || bridgeState?.activeAppId,
          resultCategory: 'success',
          transport: 'sse',
        },
      })

      writeEvent('completed', {
        content: response.content,
        model: response.model,
        bridgeState: updatedBridgeState,
        traceId,
      })
      reply.raw.end()
    } catch (error) {
      if (abortController.signal.aborted) {
        reply.raw.end()
        return reply
      }

      if (error instanceof ChatBridgeToolPolicyError) {
        await store.appendAuditEvent({
          timestamp: Date.now(),
          traceId,
          eventType: 'ModelInvocationFailed',
          source: 'bridge-backend',
          sessionId: body.sessionId,
          classId: effectiveClassId,
          appId: bridgeState?.activeAppId,
          summary: 'Backend-owned streaming model invocation failed due to ChatBridge tool policy.',
          metadata: {
            resultCategory: error.errorCode,
            transport: 'sse',
            ...(error.metadata || {}),
          },
        })

        writeEvent('error', {
          error: error.errorCode,
          traceId,
          ...(error.metadata || {}),
        })
        reply.raw.end()
        return reply
      }

      await store.appendAuditEvent({
        timestamp: Date.now(),
        traceId,
        eventType: 'ModelInvocationFailed',
        source: 'bridge-backend',
        sessionId: body.sessionId,
        classId: effectiveClassId,
        appId: bridgeState?.activeAppId,
        summary: 'Backend-owned streaming model invocation failed.',
        metadata: {
          approvedAppCount: approvedApps.length,
          activeAppId: bridgeState?.activeAppId,
          resultCategory: 'provider_error',
          transport: 'sse',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Unknown provider failure',
        },
      })

      writeEvent('error', {
        error: 'provider_unavailable',
        traceId,
      })
      reply.raw.end()
    }

    return reply
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

    const authenticatedUserId = typeof userId === 'string' ? userId : undefined
    const { bridgeState, effectiveClassId, approvedApps, traceId, orchestratedMessages, toolDefinitions } =
      await prepareChatInvocation(body, authenticatedUserId)

    await store.appendAuditEvent({
      timestamp: Date.now(),
      traceId,
      eventType: 'ModelInvocationStarted',
      source: 'bridge-backend',
      sessionId: body.sessionId,
      classId: effectiveClassId,
      appId: bridgeState?.activeAppId,
      summary: 'Backend-owned model invocation started.',
      metadata: {
        model: process.env.CHATBRIDGE_OPENAI_MODEL || 'gpt-4o-mini',
        messageCount: body.messages.length,
        approvedAppCount: approvedApps.length,
      },
    })

    try {
      const response = await chatClient({
        messages: orchestratedMessages,
        tools: toolDefinitions,
      })
      const updatedBridgeState =
        body.sessionId && authenticatedUserId ? await store.getBridgeSessionState(body.sessionId, authenticatedUserId) : undefined

      await store.appendAuditEvent({
        timestamp: Date.now(),
        traceId,
        eventType: 'ModelInvocationCompleted',
        source: 'bridge-backend',
        sessionId: body.sessionId,
        classId: effectiveClassId,
        appId: bridgeState?.activeAppId,
        summary: 'Backend-owned model invocation completed.',
        metadata: {
          model: response.model,
          approvedAppCount: approvedApps.length,
          activeAppId: bridgeState?.activeAppId,
          resultCategory: 'success',
        },
      })

      return reply.send({
        ...response,
        bridgeState: updatedBridgeState,
      })
    } catch (error) {
      if (error instanceof ChatBridgeToolPolicyError) {
        await store.appendAuditEvent({
          timestamp: Date.now(),
          traceId,
          eventType: 'ModelInvocationFailed',
          source: 'bridge-backend',
          sessionId: body.sessionId,
          classId: effectiveClassId,
          appId: bridgeState?.activeAppId,
          summary: 'Backend-owned model invocation failed due to ChatBridge tool policy.',
          metadata: {
            resultCategory: error.errorCode,
            ...(error.metadata || {}),
          },
        })

        return reply.status(error.statusCode).send({
          error: error.errorCode,
          ...(error.metadata || {}),
        })
      }

      await store.appendAuditEvent({
        timestamp: Date.now(),
        traceId,
        eventType: 'ModelInvocationFailed',
        source: 'bridge-backend',
        sessionId: body.sessionId,
        classId: effectiveClassId,
        appId: bridgeState?.activeAppId,
        summary: 'Backend-owned model invocation failed.',
        metadata: {
          approvedAppCount: approvedApps.length,
          activeAppId: bridgeState?.activeAppId,
          resultCategory: 'provider_error',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Unknown provider failure',
        },
      })

      return reply.status(502).send({
        error: 'provider_unavailable',
      })
    }
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

async function applyMutationRateLimit(input: {
  request: FastifyRequest
  reply: FastifyReply
  store: BridgeStore
  rateLimiterSet: MutationRateLimiterSet
  scope: string
}) {
  const userId = input.request.headers['x-chatbridge-user-id']
  if (!input.rateLimiterSet.perUser || typeof userId !== 'string') {
    return null
  }

  const result = input.rateLimiterSet.perUser.check(`mutation:${input.scope}:${userId}`)
  input.reply.header('X-RateLimit-Remaining', String(result.remaining))
  input.reply.header('X-RateLimit-Reset', String(result.resetAt))

  if (result.allowed) {
    return null
  }

  const retryAfterMs = Math.max(0, result.resetAt - Date.now())
  await appendAbuseAuditEvent(input.store, {
    eventType: 'MutationRateLimitExceeded',
    summary: `Mutation request rate limited for ${input.scope}.`,
    metadata: {
      scope: input.scope,
      retryAfterMs,
      userId,
      path: input.request.url,
      method: input.request.method,
    },
  })

  return input.reply.status(429).send({
    error: 'rate_limited',
    scope: input.scope,
    retryAfterMs,
  })
}
