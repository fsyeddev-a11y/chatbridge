import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { createSupabaseAuthVerifier, getBearerToken, type AuthVerifier } from './auth.js'
import {
  getRequestUserEmail,
  getRequestUserId,
  requireAnyRole,
} from './authorization.js'
import {
  buildOAuthPopupResultHtml,
  createConfiguredOAuthService,
  decryptStoredOAuthToken,
  type OAuthService,
} from './oauth.js'
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
  ChatSessionOrderBodySchema,
  ChatSessionUpsertBodySchema,
  BridgeSessionUpsertBodySchema,
  ClassAllowlistBodySchema,
  ClassAllowlistToggleBodySchema,
  ClassIdParamsSchema,
  OAuthStartBodySchema,
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
  oauthService?: OAuthService
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
  const oauthService = options.oauthService ?? createConfiguredOAuthService()

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

    const profile = await store.getOrCreateUserProfile({
      userId: user.id,
      email: user.email,
    })
    request.headers['x-chatbridge-user-role'] = profile.role
    request.headers['x-chatbridge-user-roles'] = profile.roles.join(',')
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

  app.get('/api/me', async (request, reply) => {
    const userId = getRequestUserId(request)
    const userEmail = getRequestUserEmail(request)

    if (!userId) {
      return reply.status(401).send({
        error: 'unauthorized',
      })
    }

    const profile = await store.getOrCreateUserProfile({
      userId,
      email: typeof userEmail === 'string' ? userEmail : undefined,
    })

    return {
      user: profile,
      classes: await store.listClassesForUser(userId),
      memberships: await store.listClassMembershipsForUser(userId),
    }
  })

  app.get('/api/chat-sessions', async (request, reply) => {
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    return {
      sessions: await store.listChatSessions(userId),
    }
  })

  app.get('/api/chat-sessions/:sessionId', async (request, reply) => {
    const { sessionId } = SessionIdParamsSchema.parse(request.params)
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const session = await store.getChatSession(sessionId, userId)
    if (!session) {
      return reply.status(404).send({ error: 'session_not_found' })
    }

    return {
      session: session.session,
      meta: {
        id: session.id,
        name: session.name,
        type: session.type,
        starred: session.starred,
        hidden: session.hidden,
        assistantAvatarKey: session.assistantAvatarKey,
        picUrl: session.picUrl,
      },
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
    }
  })

  app.put('/api/chat-sessions/:sessionId', async (request, reply) => {
    const { sessionId } = SessionIdParamsSchema.parse(request.params)
    const { session, previousSessionId } = ChatSessionUpsertBodySchema.parse(request.body)
    const userId = request.headers['x-chatbridge-user-id']
    const userEmail = request.headers['x-chatbridge-user-email']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }
    if (session.id !== sessionId) {
      return reply.status(400).send({ error: 'session_id_mismatch' })
    }

    const record = await store.upsertChatSession(session, {
      userId,
      email: typeof userEmail === 'string' ? userEmail : undefined,
    }, previousSessionId)

    return reply.status(200).send({
      session: record.session,
      meta: {
        id: record.id,
        name: record.name,
        type: record.type,
        starred: record.starred,
        hidden: record.hidden,
        assistantAvatarKey: record.assistantAvatarKey,
        picUrl: record.picUrl,
      },
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
    })
  })

  app.put('/api/chat-sessions/reorder', async (request, reply) => {
    const { sessionIds } = ChatSessionOrderBodySchema.parse(request.body)
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    return {
      sessions: await store.reorderChatSessions(userId, sessionIds),
    }
  })

  app.delete('/api/chat-sessions/:sessionId', async (request, reply) => {
    const { sessionId } = SessionIdParamsSchema.parse(request.params)
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const deleted = await store.deleteChatSession(sessionId, userId)
    if (!deleted) {
      return reply.status(404).send({ error: 'session_not_found' })
    }

    return reply.status(204).send()
  })

  app.get('/api/registry/apps', async () => {
    return {
      apps: await store.listRegistryEntries(),
    }
  })

  app.get('/api/developer/apps', async (request, reply) => {
    const denied = requireAnyRole(request, reply, ['developer', 'admin'])
    if (denied) {
      return denied
    }
    const userId = getRequestUserId(request)!

    return {
      apps: await store.listRegistryEntriesForOwner(userId),
    }
  })

  app.get('/api/developer/review-actions', async (request, reply) => {
    const denied = requireAnyRole(request, reply, ['developer', 'admin'])
    if (denied) {
      return denied
    }
    const userId = getRequestUserId(request)!

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
    const denied = requireAnyRole(request, reply, ['developer', 'admin'])
    if (denied) {
      return denied
    }
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
    const denied = requireAnyRole(request, reply, ['admin'])
    if (denied) {
      return denied
    }
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
    const { reviewState, reviewNotes, version } = ReviewActionBodySchema.parse(request.body)
    const reviewerId = getRequestUserId(request)!
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

  app.get('/api/oauth/apps/:appId/status', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const appEntry = await store.getRegistryEntry(appId)
    if (!appEntry) {
      return reply.status(404).send({ error: 'app_not_found' })
    }
    if (appEntry.manifest.authType !== 'oauth2' || !appEntry.manifest.oauthProvider) {
      return reply.status(400).send({ error: 'oauth_not_supported' })
    }

    const token = await store.getOAuthToken(userId, appId, appEntry.manifest.oauthProvider)
    const connected = Boolean(token && (!token.expiresAt || token.expiresAt > Date.now()))

    return {
      appId,
      provider: appEntry.manifest.oauthProvider,
      connected,
      expiresAt: token?.expiresAt,
      scopes: token?.scopes || [],
    }
  })

  app.post('/api/oauth/apps/:appId/start', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const { sessionId } = OAuthStartBodySchema.parse(request.body)
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const appEntry = await store.getRegistryEntry(appId)
    if (!appEntry) {
      return reply.status(404).send({ error: 'app_not_found' })
    }
    if (appEntry.manifest.authType !== 'oauth2') {
      return reply.status(400).send({ error: 'oauth_not_supported' })
    }

    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    if (!origin || !allowedOrigins.has(origin)) {
      return reply.status(400).send({ error: 'invalid_return_origin' })
    }

    try {
      const result = oauthService.createAuthorizationRequest({
        app: appEntry.manifest,
        userId,
        sessionId,
        returnOrigin: origin,
      })

      await store.appendAuditEvent({
        timestamp: Date.now(),
        traceId: `oauth-start-${randomUUID()}`,
        eventType: 'OAuthAuthorizationStarted',
        source: 'bridge-backend',
        sessionId,
        appId,
        appVersion: appEntry.manifest.version,
        summary: `Started OAuth flow for ${appEntry.manifest.name}.`,
        metadata: {
          provider: result.provider,
        },
      })

      return {
        appId,
        provider: result.provider,
        authUrl: result.authUrl,
      }
    } catch (error) {
      return reply.status(400).send({
        error: 'oauth_configuration_error',
        message: error instanceof Error ? error.message : 'OAuth configuration failed.',
      })
    }
  })

  app.post('/api/oauth/apps/:appId/revoke', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const userId = request.headers['x-chatbridge-user-id']
    if (typeof userId !== 'string') {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const appEntry = await store.getRegistryEntry(appId)
    if (!appEntry) {
      return reply.status(404).send({ error: 'app_not_found' })
    }
    if (appEntry.manifest.authType !== 'oauth2' || !appEntry.manifest.oauthProvider) {
      return reply.status(400).send({ error: 'oauth_not_supported' })
    }

    const token = await store.getOAuthToken(userId, appId, appEntry.manifest.oauthProvider)
    if (token) {
      try {
        await oauthService.revokeToken({
          provider: token.provider,
          accessToken: decryptStoredOAuthToken(token.accessToken),
        })
      } catch {
        // Best-effort provider revocation; the local delete is the durable control plane action.
      }
    }

    const deleted = await store.deleteOAuthToken(userId, appId, appEntry.manifest.oauthProvider)
    await store.appendAuditEvent({
      timestamp: Date.now(),
      traceId: `oauth-revoke-${randomUUID()}`,
      eventType: 'OAuthAuthorizationRevoked',
      source: 'bridge-backend',
      appId,
      appVersion: appEntry.manifest.version,
      summary: `Revoked OAuth access for ${appEntry.manifest.name}.`,
      metadata: {
        provider: appEntry.manifest.oauthProvider,
        deleted,
      },
    })

    return {
      appId,
      provider: appEntry.manifest.oauthProvider,
      revoked: deleted,
    }
  })

  app.get('/api/classes/:classId/apps', async (request) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    return {
      classId,
      apps: await store.listApprovedAppsForClass(classId),
    }
  })

  app.get('/api/classes/:classId/allowlist', async (request, reply) => {
    const denied = requireAnyRole(request, reply, ['teacher', 'admin'])
    if (denied) {
      return denied
    }
    const { classId } = ClassIdParamsSchema.parse(request.params)
    return {
      classId,
      allowlist: await store.listClassAllowlist(classId),
    }
  })

  app.post('/api/classes/:classId/allowlist', async (request, reply) => {
    const denied = requireAnyRole(request, reply, ['teacher', 'admin'])
    if (denied) {
      return denied
    }
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
    const { appId } = ClassAllowlistBodySchema.parse(request.body)
    const enabledBy = getRequestUserId(request)!
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
    const denied = requireAnyRole(request, reply, ['teacher', 'admin'])
    if (denied) {
      return denied
    }
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
    ClassAllowlistToggleBodySchema.parse(request.body)
    const enabledBy = getRequestUserId(request)!
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

  app.get('/api/audit/events', async (request, reply) => {
    const denied = requireAnyRole(request, reply, ['admin'])
    if (denied) {
      return denied
    }
    return {
      events: await store.listAuditEvents(),
    }
  })

  app.get('/api/review-actions', async (request, reply) => {
    const denied = requireAnyRole(request, reply, ['admin'])
    if (denied) {
      return denied
    }
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

  app.get('/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string }

    if (query.error || !query.code || !query.state) {
      const html = buildOAuthPopupResultHtml({
        success: false,
        appId: 'unknown',
        provider: 'google',
        targetOrigin: getConfiguredAllowedOrigins()[0] || 'http://localhost:3000',
        error: query.error || 'missing_code_or_state',
      })
      return reply.type('text/html').send(html)
    }

    try {
      const result = await oauthService.handleCallback({
        code: query.code,
        state: query.state,
      })

      await store.upsertOAuthToken(result.record)
      await store.appendAuditEvent({
        timestamp: Date.now(),
        traceId: `oauth-callback-${randomUUID()}`,
        eventType: 'OAuthAuthorizationCompleted',
        source: 'bridge-backend',
        sessionId: result.sessionId,
        appId: result.appId,
        summary: `OAuth authorization completed for ${result.appId}.`,
        metadata: {
          provider: result.provider,
        },
      })

      return reply.type('text/html').send(
        buildOAuthPopupResultHtml({
          success: true,
          appId: result.appId,
          provider: result.provider,
          targetOrigin: result.returnOrigin,
          sessionId: result.sessionId,
        })
      )
    } catch (error) {
      return reply.type('text/html').send(
        buildOAuthPopupResultHtml({
          success: false,
          appId: 'unknown',
          provider: 'google',
          targetOrigin: getConfiguredAllowedOrigins()[0] || 'http://localhost:3000',
          error: error instanceof Error ? error.message : 'oauth_callback_failed',
        })
      )
    }
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
    const abortStream = () => {
      if (!abortController.signal.aborted) {
        abortController.abort()
      }
    }
    const handleClientDisconnect = () => {
      if (!reply.raw.writableEnded) {
        abortStream()
      }
    }
    request.raw.on('aborted', abortStream)
    reply.raw.on('close', handleClientDisconnect)

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
    } finally {
      request.raw.off('aborted', abortStream)
      reply.raw.off('close', handleClientDisconnect)
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
