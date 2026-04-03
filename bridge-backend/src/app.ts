import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { createSupabaseAuthVerifier, getBearerToken, type AuthVerifier } from './auth.js'
import { createOpenAIChatClient, type ChatCompletionClient } from './chat.js'
import {
  AppIdParamsSchema,
  AppManifestSchema,
  AuditEventSchema,
  BackendChatRequestSchema,
  ClassAllowlistBodySchema,
  ClassAllowlistToggleBodySchema,
  ClassIdParamsSchema,
  ReviewActionBodySchema,
} from './schemas.js'
import { createInMemoryBridgeStore, type BridgeStore } from './store.js'

export type AppOptions = {
  store?: BridgeStore
  allowedOrigins?: string[]
  authVerifier?: AuthVerifier
  chatClient?: ChatCompletionClient
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

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
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
      apps: store.listRegistryEntries(),
    }
  })

  app.get('/api/registry/apps/:appId', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const appEntry = store.getRegistryEntry(appId)
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
    const appEntry = store.registerApp(manifest)
    return reply.status(201).send({
      app: appEntry,
    })
  })

  app.post('/api/registry/apps/:appId/review', async (request, reply) => {
    const { appId } = AppIdParamsSchema.parse(request.params)
    const { reviewState, reviewerId, reviewNotes } = ReviewActionBodySchema.parse(request.body)
    const updated = store.updateReviewState(appId, reviewState, reviewerId, reviewNotes)
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
      apps: store.listApprovedAppsForClass(classId),
    }
  })

  app.get('/api/classes/:classId/allowlist', async (request) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    return {
      classId,
      allowlist: store.listClassAllowlist(classId),
    }
  })

  app.post('/api/classes/:classId/allowlist', async (request, reply) => {
    const { classId } = ClassIdParamsSchema.parse(request.params)
    const { appId, enabledBy } = ClassAllowlistBodySchema.parse(request.body)
    const allowlistEntry = store.enableAppForClass(classId, appId, enabledBy)
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
    const allowlistEntry = store.disableAppForClass(classId, appId, enabledBy)
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
    const storedEvent = store.appendAuditEvent(event)
    return reply.status(202).send({
      accepted: true,
      event: storedEvent,
    })
  })

  app.get('/api/audit/events', async () => {
    return {
      events: store.listAuditEvents(),
    }
  })

  app.get('/api/review-actions', async () => {
    return {
      actions: store.listReviewActions(),
    }
  })

  app.post('/api/chat/generate', async (request, reply) => {
    const body = BackendChatRequestSchema.parse(request.body)
    const response = await chatClient({
      messages: body.messages,
    })

    return reply.send(response)
  })

  return app
}
