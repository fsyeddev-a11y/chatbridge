import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createApp, getConfiguredAllowedOrigins } from '../src/app.js'
import type { ChatCompletionClient, ChatCompletionStreamClient } from '../src/chat.js'
import type { OAuthService } from '../src/oauth.js'
import { createInMemoryFixedWindowRateLimiter } from '../src/rate-limit.js'
import {
  createConfiguredBridgeStore,
  createFileBackedBridgeStore,
  createInMemoryBridgeStore,
  getAllowedOriginsForLaunchUrl,
  getConfiguredStoreDriver,
  getConfiguredWeatherAppUrl,
} from '../src/store.js'

describe('bridge-backend app', () => {
  const allowAllAuth = async () => ({
    id: 'user-1',
    email: 'tester@example.com',
  })
  const fakeChatClient: ChatCompletionClient = async () => ({
    content: 'Bridge-backed answer',
    model: 'gpt-4o-mini',
  })
  const fakeOAuthService: OAuthService = {
    getProviderConfig: () => ({
      provider: 'google',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authEndpoint: 'https://accounts.example.com/o/oauth2/auth',
      tokenEndpoint: 'https://accounts.example.com/o/oauth2/token',
      revokeEndpoint: 'https://accounts.example.com/o/oauth2/revoke',
      supportedScopes: [
        'https://www.googleapis.com/auth/classroom.courses.readonly',
        'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      ],
    }),
    createAuthorizationRequest: ({ app, sessionId, userId, returnOrigin }) => ({
      provider: 'google',
      authUrl: `https://accounts.example.com/authorize?appId=${app.appId}&sessionId=${sessionId || ''}&userId=${userId}&origin=${encodeURIComponent(returnOrigin)}`,
    }),
    handleCallback: async () => ({
      appId: 'google-classroom',
      provider: 'google',
      userId: 'user-1',
      sessionId: 'session-1',
      returnOrigin: 'http://localhost:3000',
      record: {
        userId: 'user-1',
        appId: 'google-classroom',
        provider: 'google',
        accessToken: 'encrypted-access',
        refreshToken: 'encrypted-refresh',
        expiresAt: Date.now() + 60_000,
        scopes: ['https://www.googleapis.com/auth/classroom.courses.readonly'],
        createdAt: Date.now(),
        lastRefreshedAt: Date.now(),
      },
    }),
    revokeToken: async () => {},
  }

  it('returns health status', async () => {
    const app = createApp({ store: createInMemoryBridgeStore() })
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      status: 'ok',
      service: 'bridge-backend',
    })
  })

  it('parses deployment origins and weather app url overrides safely', () => {
    assert.deepEqual(getConfiguredAllowedOrigins('https://chat.example.com, https://weather.example.com'), [
      'https://chat.example.com',
      'https://weather.example.com',
    ])
    assert.equal(getConfiguredWeatherAppUrl('https://weather.example.com/app/'), 'https://weather.example.com/app')
    assert.deepEqual(getAllowedOriginsForLaunchUrl('https://weather.example.com/app'), ['https://weather.example.com'])
    assert.equal(getConfiguredWeatherAppUrl('not-a-url'), 'http://localhost:4173')
  })

  it('returns approved apps for a class from backend-owned allowlist state', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'GET',
      url: '/api/classes/demo-class/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.classId, 'demo-class')
    assert.deepEqual(
      payload.apps.map((entry: { manifest: { appId: string } }) => entry.manifest.appId).sort(),
      ['chess', 'google-classroom', 'weather']
    )
  })

  it('accepts structured audit events', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/events',
      headers: {
        origin: 'http://localhost:3000',
        authorization: 'Bearer token-1',
      },
      payload: {
        timestamp: Date.now(),
        traceId: 'trace-1',
        eventType: 'GenerationStarted',
        source: 'frontend',
        sessionId: 'session-1',
      },
    })

    assert.equal(response.statusCode, 202)
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000')
    const payload = response.json()
    assert.equal(payload.accepted, true)
    assert.equal(payload.event.traceId, 'trace-1')
    assert.equal(payload.event.eventType, 'GenerationStarted')
    assert.equal(payload.event.source, 'frontend')
  })

  it('rejects invalid audit events', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/events',
      headers: {
        origin: 'http://localhost:3000',
        authorization: 'Bearer token-1',
      },
      payload: {
        source: 'frontend',
      },
    })

    assert.equal(response.statusCode, 400)
    assert.equal(response.json().error, 'malformed')
  })

  it('responds to audit preflight requests with the required CORS headers', async () => {
    const app = createApp({ store: createInMemoryBridgeStore() })
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/audit/events',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Content-Type',
      },
    })

    assert.equal(response.statusCode, 204)
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000')
    assert.equal(response.headers['access-control-allow-methods'], 'GET,POST,PUT,OPTIONS')
    assert.equal(response.headers['access-control-allow-headers'], 'Content-Type,Authorization')
  })

  it('rejects unauthenticated api requests', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'GET',
      url: '/api/registry/apps',
    })

    assert.equal(response.statusCode, 401)
    assert.deepEqual(response.json(), {
      error: 'unauthorized',
    })
  })

  it('persists seeded store data and appended audit events to disk', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'chatbridge-store-'))
    const storePath = path.join(tempDir, 'bridge-store.json')
    const store = createFileBackedBridgeStore(storePath)

    assert.deepEqual(
      (await store.listApprovedAppsForClass('demo-class')).map((entry) => entry.manifest.appId).sort(),
      ['chess', 'google-classroom', 'weather']
    )

    await store.appendAuditEvent({
      timestamp: Date.now(),
      traceId: 'trace-persisted',
      eventType: 'AppReadyReceived',
      source: 'frontend',
      sessionId: 'session-42',
    })

    const persisted = JSON.parse(readFileSync(storePath, 'utf8')) as {
      auditEvents: Array<{ traceId: string; eventType: string }>
    }
    assert.equal(persisted.auditEvents.at(-1)?.traceId, 'trace-persisted')
    assert.equal(persisted.auditEvents.at(-1)?.eventType, 'AppReadyReceived')
  })

  it('migrates legacy weather manifests to the real local weather app origin', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'chatbridge-store-migrate-'))
    const storePath = path.join(tempDir, 'bridge-store.json')

    writeFileSync(
      storePath,
      JSON.stringify(
        {
          registryEntries: [
            {
              reviewState: 'approved',
              registeredAt: Date.now(),
              manifest: {
                appId: 'weather',
                name: 'Weather Dashboard',
                version: '1.0.0',
                description: 'Legacy weather app',
                developerName: 'ChatBridge Demo',
                executionModel: 'iframe',
                allowedOrigins: ['https://apps.chatbridge.local'],
                authType: 'none',
                subjectTags: ['Science'],
                gradeBand: 'K-12',
                llmSafeFields: ['location'],
                tools: [
                  {
                    name: 'chatbridge_weather_lookup',
                    description: 'Look up current weather.',
                  },
                ],
              },
            },
          ],
          classAllowlist: [],
          auditEvents: [],
          reviewActions: [],
        },
        null,
        2
      ),
      'utf8'
    )

    const store = createFileBackedBridgeStore(storePath)
    const weather = await store.getRegistryEntry('weather')

    assert.equal(weather?.manifest.launchUrl, 'http://localhost:4173')
    assert.deepEqual(weather?.manifest.allowedOrigins, ['http://localhost:4173'])
    assert.equal(weather?.manifest.heartbeatTimeoutMs, 10000)
  })

  it('registers a new app manifest as pending review', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'POST',
      url: '/api/registry/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
    })

    assert.equal(response.statusCode, 201)
    assert.equal(response.json().app.reviewState, 'pending')
    assert.equal(response.json().app.manifest.appId, 'story-builder')
    assert.equal(response.json().app.ownerUserId, 'user-1')
    assert.equal(response.json().app.ownerEmail, 'tester@example.com')
  })

  it('returns only developer-owned apps from the developer apps endpoint', async () => {
    const store = createInMemoryBridgeStore()
    await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
      {
        userId: 'user-1',
        email: 'tester@example.com',
      }
    )

    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'GET',
      url: '/api/developer/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(
      response.json().apps.map((entry: { manifest: { appId: string } }) => entry.manifest.appId),
      ['story-builder']
    )
  })

  it('keeps the active approved version live while a newer submission stays pending', async () => {
    const store = createInMemoryBridgeStore()
    await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
      {
        userId: 'user-1',
        email: 'tester@example.com',
      }
    )
    await store.updateReviewState('story-builder', 'approved', 'admin-1', 'Initial release approved.', '1.0.0')
    await store.enableAppForClass('demo-class', 'story-builder', 'teacher-1')

    await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.1.0',
        description: 'Structured story building for students with revision mode.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
      {
        userId: 'user-1',
        email: 'tester@example.com',
      }
    )

    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const developerResponse = await app.inject({
      method: 'GET',
      url: '/api/developer/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
    })
    const classAppsResponse = await app.inject({
      method: 'GET',
      url: '/api/classes/demo-class/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(developerResponse.statusCode, 200)
    assert.equal(classAppsResponse.statusCode, 200)

    const developerApp = developerResponse
      .json()
      .apps.find((entry: { manifest: { appId: string } }) => entry.manifest.appId === 'story-builder') as {
      manifest: { version: string }
      activeVersion?: string
      pendingVersion?: string
      reviewState: string
    }
    const liveClassApp = classAppsResponse
      .json()
      .apps.find((entry: { manifest: { appId: string } }) => entry.manifest.appId === 'story-builder') as {
      manifest: { version: string }
    }

    assert.equal(developerApp.reviewState, 'pending')
    assert.equal(developerApp.manifest.version, '1.1.0')
    assert.equal(developerApp.activeVersion, '1.0.0')
    assert.equal(developerApp.pendingVersion, '1.1.0')
    assert.equal(liveClassApp.manifest.version, '1.0.0')
  })

  it('approves a specific submitted version without losing the currently active one first', async () => {
    const store = createInMemoryBridgeStore()
    await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
      {
        userId: 'user-1',
        email: 'tester@example.com',
      }
    )
    await store.updateReviewState('story-builder', 'approved', 'admin-1', 'Initial release approved.', '1.0.0')
    await store.enableAppForClass('demo-class', 'story-builder', 'teacher-1')
    await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.1.0',
        description: 'Structured story building for students with revision mode.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
      {
        userId: 'user-1',
        email: 'tester@example.com',
      }
    )

    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const reviewResponse = await app.inject({
      method: 'POST',
      url: '/api/registry/apps/story-builder/review',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        reviewState: 'approved',
        reviewerId: 'admin-1',
        reviewNotes: 'Revision mode approved.',
        version: '1.1.0',
      },
    })
    const classAppsResponse = await app.inject({
      method: 'GET',
      url: '/api/classes/demo-class/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(reviewResponse.statusCode, 200)
    assert.equal(reviewResponse.json().app.manifest.version, '1.1.0')
    assert.equal(reviewResponse.json().app.activeVersion, '1.1.0')
    assert.equal(classAppsResponse.statusCode, 200)
    assert.equal(
      classAppsResponse
        .json()
        .apps.find((entry: { manifest: { appId: string } }) => entry.manifest.appId === 'story-builder')?.manifest.version,
      '1.1.0'
    )
  })

  it('returns only developer review actions for owned apps', async () => {
    const store = createInMemoryBridgeStore()
    await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
      {
        userId: 'user-1',
        email: 'tester@example.com',
      }
    )
    await store.updateReviewState('story-builder', 'rejected', 'admin-1', 'Add stronger moderation copy.')
    await store.updateReviewState('weather', 'suspended', 'admin-1', 'Weather review note.')

    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'GET',
      url: '/api/developer/review-actions',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(
      response.json().actions.map((action: { appId: string; action: string; notes?: string }) => ({
        appId: action.appId,
        action: action.action,
        notes: action.notes,
      })),
      [
        {
          appId: 'story-builder',
          action: 'reject',
          notes: 'Add stronger moderation copy.',
        },
      ]
    )
  })

  it('starts an oauth flow for oauth2 apps and returns a popup url', async () => {
    const app = createApp({
      store: createInMemoryBridgeStore(),
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      oauthService: fakeOAuthService,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/oauth/apps/google-classroom/start',
      headers: {
        authorization: 'Bearer token-1',
        origin: 'http://localhost:3000',
      },
      payload: {
        sessionId: 'session-1',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.json().provider, 'google')
    assert.match(response.json().authUrl, /accounts\.example\.com\/authorize/)
  })

  it('stores oauth tokens on callback and reports connected status', async () => {
    const store = createInMemoryBridgeStore()
    const app = createApp({
      store,
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      oauthService: fakeOAuthService,
    })

    const callbackResponse = await app.inject({
      method: 'GET',
      url: '/oauth/callback?code=oauth-code&state=signed-state',
    })
    assert.equal(callbackResponse.statusCode, 200)
    assert.match(callbackResponse.body, /chatbridge-oauth/)

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/api/oauth/apps/google-classroom/status',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(statusResponse.statusCode, 200)
    assert.equal(statusResponse.json().connected, true)
    assert.equal(statusResponse.json().provider, 'google')
  })

  it('revokes oauth tokens for oauth2 apps', async () => {
    const store = createInMemoryBridgeStore()
    await store.upsertOAuthToken({
      userId: 'user-1',
      appId: 'google-classroom',
      provider: 'google',
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      expiresAt: Date.now() + 60_000,
      scopes: ['https://www.googleapis.com/auth/classroom.courses.readonly'],
      createdAt: Date.now(),
      lastRefreshedAt: Date.now(),
    })

    const app = createApp({
      store,
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      oauthService: fakeOAuthService,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/oauth/apps/google-classroom/revoke',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.json().revoked, true)
    assert.equal(await store.getOAuthToken('user-1', 'google-classroom', 'google'), undefined)
  })

  it('selects the configured store driver safely', () => {
    assert.equal(getConfiguredStoreDriver(), 'file')
    assert.equal(getConfiguredStoreDriver('supabase'), 'supabase')
    assert.equal(getConfiguredStoreDriver('invalid'), 'file')
  })

  it('creates a file-backed store by default from configuration', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'chatbridge-configured-store-'))
    const storePath = path.join(tempDir, 'bridge-store.json')
    const originalDriver = process.env.CHATBRIDGE_STORE_DRIVER

    process.env.CHATBRIDGE_STORE_DRIVER = 'file'

    try {
      const store = createConfiguredBridgeStore(storePath)
      const apps = await store.listRegistryEntries()
      assert.ok(apps.length > 0)
    } finally {
      if (originalDriver === undefined) {
        delete process.env.CHATBRIDGE_STORE_DRIVER
      } else {
        process.env.CHATBRIDGE_STORE_DRIVER = originalDriver
      }
    }
  })

  it('updates review state and exposes review actions', async () => {
    const store = createInMemoryBridgeStore()
    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })

    const reviewResponse = await app.inject({
      method: 'POST',
      url: '/api/registry/apps/chess/review',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        reviewState: 'suspended',
        reviewerId: 'admin-1',
        reviewNotes: 'Safety review in progress.',
      },
    })

    assert.equal(reviewResponse.statusCode, 200)
    assert.equal(reviewResponse.json().app.reviewState, 'suspended')

    const actionsResponse = await app.inject({
      method: 'GET',
      url: '/api/review-actions',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(actionsResponse.statusCode, 200)
    assert.equal(actionsResponse.json().actions.at(-1)?.appId, 'chess')
    assert.equal(actionsResponse.json().actions.at(-1)?.action, 'suspend')
  })

  it('enables and disables apps per class through the allowlist API', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })

    const enableResponse = await app.inject({
      method: 'POST',
      url: '/api/classes/algebra-1/allowlist',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'chess',
        enabledBy: 'teacher-1',
      },
    })

    assert.equal(enableResponse.statusCode, 201)
    assert.equal(enableResponse.json().allowlistEntry.classId, 'algebra-1')
    assert.equal(enableResponse.json().allowlistEntry.appId, 'chess')

    const disableResponse = await app.inject({
      method: 'POST',
      url: '/api/classes/algebra-1/allowlist/chess/disable',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        enabledBy: 'teacher-1',
      },
    })

    assert.equal(disableResponse.statusCode, 200)
    assert.equal(typeof disableResponse.json().allowlistEntry.disabledAt, 'number')
  })

  it('rejects allowlist enables for apps that are missing or not platform-approved', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })

    const missingAppResponse = await app.inject({
      method: 'POST',
      url: '/api/classes/algebra-1/allowlist',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'unknown-app',
        enabledBy: 'teacher-1',
      },
    })

    assert.equal(missingAppResponse.statusCode, 404)
    assert.deepEqual(missingAppResponse.json(), {
      error: 'approved_app_not_found',
    })

    const registerPendingResponse = await app.inject({
      method: 'POST',
      url: '/api/registry/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
    })

    assert.equal(registerPendingResponse.statusCode, 201)
    assert.equal(registerPendingResponse.json().app.reviewState, 'pending')

    const pendingAppEnableResponse = await app.inject({
      method: 'POST',
      url: '/api/classes/algebra-1/allowlist',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'story-builder',
        enabledBy: 'teacher-1',
      },
    })

    assert.equal(pendingAppEnableResponse.statusCode, 404)
    assert.deepEqual(pendingAppEnableResponse.json(), {
      error: 'approved_app_not_found',
    })
  })

  it('generates chat completions through the backend-owned chat route', async () => {
    const app = createApp({ store: createInMemoryBridgeStore(), authVerifier: allowAllAuth, chatClient: fakeChatClient })
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        messages: [
          {
            role: 'user',
            content: 'Hello from TutorMeAI',
          },
        ],
      },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      content: 'Bridge-backed answer',
      model: 'gpt-4o-mini',
    })
  })

  it('streams chat completions through the backend-owned SSE route', async () => {
    const fakeChatStreamClient: ChatCompletionStreamClient = async (_request, handlers) => {
      handlers?.onStart?.({ model: 'gpt-4o-mini' })
      handlers?.onTextDelta?.('Bridge-')
      handlers?.onTextDelta?.('backed answer')
      return {
        content: 'Bridge-backed answer',
        model: 'gpt-4o-mini',
      }
    }

    const app = createApp({
      store: createInMemoryBridgeStore(),
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      chatStreamClient: fakeChatStreamClient,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        messages: [
          {
            role: 'user',
            content: 'Hello from TutorMeAI',
          },
        ],
      },
    })

    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'] || '', /text\/event-stream/)
    assert.match(response.body, /event: started/)
    assert.match(response.body, /event: delta/)
    assert.match(response.body, /Bridge-backed answer/)
    assert.match(response.body, /event: completed/)
  })

  it('prepends backend-owned ChatBridge policy context to chat generation', async () => {
    const store = createInMemoryBridgeStore()
    await store.upsertBridgeSessionState('session-1', 'user-1', {
      activeClassId: 'demo-class',
      activeAppId: 'weather',
      appContext: {
        weather: {
          appId: 'weather',
          status: 'active',
          lastState: {
            location: 'Austin',
            conditions: 'Sunny',
            temperatureF: 82,
            privateNote: 'do-not-send',
          },
        },
      },
    })

    let capturedMessages: Array<{ role: string; content: string }> = []
    const capturingChatClient: ChatCompletionClient = async ({ messages }) => {
      capturedMessages = messages
      return {
        content: 'Bridge-backed answer',
        model: 'gpt-4o-mini',
      }
    }

    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: capturingChatClient })
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-1',
        classId: 'demo-class',
        messages: [
          {
            role: 'user',
            content: 'Can you help me with weather?',
          },
        ],
      },
    })

    assert.equal(response.statusCode, 200)
    assert.equal(capturedMessages[0]?.role, 'system')
    assert.match(capturedMessages[0]?.content || '', /Class-approved ChatBridge apps:/)
    assert.match(capturedMessages[0]?.content || '', /Weather Dashboard/)
    assert.match(capturedMessages[0]?.content || '', /Chess Coach/)
    assert.match(capturedMessages[0]?.content || '', /location: "Austin"/)
    assert.doesNotMatch(capturedMessages[0]?.content || '', /privateNote/)
  })

  it('audits backend model invocation lifecycle events', async () => {
    const store = createInMemoryBridgeStore()
    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-2',
        classId: 'demo-class',
        messages: [
          {
            role: 'user',
            content: 'Hello from TutorMeAI',
          },
        ],
      },
    })

    assert.equal(response.statusCode, 200)
    const auditEvents = await store.listAuditEvents()
    assert.equal(auditEvents.at(-2)?.eventType, 'ModelInvocationStarted')
    assert.equal(auditEvents.at(-1)?.eventType, 'ModelInvocationCompleted')
    assert.equal(auditEvents.at(-1)?.source, 'bridge-backend')
  })

  it('returns provider_unavailable and audits failures when backend chat invocation fails', async () => {
    const store = createInMemoryBridgeStore()
    const failingChatClient: ChatCompletionClient = async () => {
      throw new Error('OpenAI unavailable')
    }
    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: failingChatClient })

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-3',
        classId: 'demo-class',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    assert.equal(response.statusCode, 502)
    assert.deepEqual(response.json(), {
      error: 'provider_unavailable',
    })

    const auditEvents = await store.listAuditEvents()
    assert.equal(auditEvents.at(-2)?.eventType, 'ModelInvocationStarted')
    assert.equal(auditEvents.at(-1)?.eventType, 'ModelInvocationFailed')
  })

  it('executes approved ChatBridge tools through the backend and returns updated bridge state', async () => {
    const store = createInMemoryBridgeStore()
    const toolCallingChatClient: ChatCompletionClient = async ({ tools }) => {
      const weatherTool = tools?.find((tool) => tool.name === 'chatbridge_weather_lookup')
      assert.ok(weatherTool)
      const toolResult = await weatherTool.execute()
      return {
        content: `I opened ${toolResult.appName} for the student.`,
        model: 'gpt-4o-mini',
        toolResults: [toolResult],
      }
    }

    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: toolCallingChatClient })
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-tools-1',
        classId: 'demo-class',
        messages: [{ role: 'user', content: 'Open the weather app for Austin.' }],
      },
    })

    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.content, 'I opened Weather Dashboard for the student.')
    assert.equal(payload.toolResults?.[0]?.toolName, 'chatbridge_weather_lookup')
    assert.equal(payload.bridgeState?.activeAppId, 'weather')
    assert.equal(payload.bridgeState?.appContext?.weather?.status, 'active')

    const persistedBridgeState = await store.getBridgeSessionState('session-tools-1', 'user-1')
    assert.equal(persistedBridgeState?.activeAppId, 'weather')

    const auditEvents = await store.listAuditEvents()
    assert.equal(auditEvents.some((event) => event.eventType === 'ChatBridgeToolInvoked'), true)
  })

  it('rate-limits repeated backend tool invocations per user and app', async () => {
    const store = createInMemoryBridgeStore()
    const toolCallingChatClient: ChatCompletionClient = async ({ tools }) => {
      const weatherTool = tools?.find((tool) => tool.name === 'chatbridge_weather_lookup')
      assert.ok(weatherTool)
      const toolResult = await weatherTool.execute()
      return {
        content: `I opened ${toolResult.appName} for the student.`,
        model: 'gpt-4o-mini',
        toolResults: [toolResult],
      }
    }

    const app = createApp({
      store,
      authVerifier: allowAllAuth,
      chatClient: toolCallingChatClient,
      toolRateLimiterSet: {
        perUserPerApp: createInMemoryFixedWindowRateLimiter(1, 60_000),
      },
    })

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-tools-2',
        classId: 'demo-class',
        messages: [{ role: 'user', content: 'Open the weather app.' }],
      },
    })

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-tools-2',
        classId: 'demo-class',
        messages: [{ role: 'user', content: 'Open the weather app again.' }],
      },
    })

    assert.equal(firstResponse.statusCode, 200)
    assert.equal(secondResponse.statusCode, 429)
    assert.equal(secondResponse.json().error, 'rate_limited')
    assert.equal(secondResponse.json().scope, 'tool:weather')

    const auditEvents = await store.listAuditEvents()
    assert.equal(auditEvents.some((event) => event.eventType === 'ToolRateLimitExceeded'), true)
  })

  it('rate-limits backend chat generation when configured', async () => {
    const app = createApp({
      store: createInMemoryBridgeStore(),
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      chatRateLimiter: createInMemoryFixedWindowRateLimiter(1, 60_000),
    })

    const first = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    const second = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        messages: [{ role: 'user', content: 'again' }],
      },
    })

    assert.equal(first.statusCode, 200)
    assert.equal(second.statusCode, 429)
    assert.equal(second.json().error, 'rate_limited')
  })

  it('returns oversized for chat requests that exceed policy limits and audits the rejection', async () => {
    const store = createInMemoryBridgeStore()
    const app = createApp({ store, authVerifier: allowAllAuth, chatClient: fakeChatClient })

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        messages: [
          {
            role: 'user',
            content: 'x'.repeat(8001),
          },
        ],
      },
    })

    assert.equal(response.statusCode, 413)
    assert.equal(response.json().error, 'oversized')

    const auditEvents = await store.listAuditEvents()
    assert.equal(auditEvents.at(-1)?.eventType, 'OversizedRequestRejected')
  })

  it('applies per-session rate limits when a chat session id is provided', async () => {
    const app = createApp({
      store: createInMemoryBridgeStore(),
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      chatRateLimiterSet: {
        perUser: null,
        perSession: createInMemoryFixedWindowRateLimiter(1, 60_000),
        perIp: null,
      },
    })

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-1',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/chat/generate',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        sessionId: 'session-1',
        messages: [{ role: 'user', content: 'Hello again' }],
      },
    })

    assert.equal(firstResponse.statusCode, 200)
    assert.equal(secondResponse.statusCode, 429)
    assert.equal(secondResponse.json().scope, 'session')
  })

  it('rate-limits repeated registry mutations when configured', async () => {
    const app = createApp({
      store: createInMemoryBridgeStore(),
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
      mutationRateLimiterSet: {
        perUser: createInMemoryFixedWindowRateLimiter(1, 60_000),
      },
    })

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/registry/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open the story builder.',
          },
        ],
      },
    })

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/registry/apps',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        appId: 'story-builder-2',
        name: 'AI Story Builder Two',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        llmSafeFields: ['chapterTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open_two',
            description: 'Open the story builder.',
          },
        ],
      },
    })

    assert.equal(firstResponse.statusCode, 201)
    assert.equal(secondResponse.statusCode, 429)
    assert.equal(secondResponse.json().error, 'rate_limited')
    assert.equal(secondResponse.json().scope, 'registry_register')
  })

  it('persists and reloads bridge session state through the backend session API', async () => {
    const app = createApp({
      store: createInMemoryBridgeStore(),
      authVerifier: allowAllAuth,
      chatClient: fakeChatClient,
    })

    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/sessions/session-1/bridge-state',
      headers: {
        authorization: 'Bearer token-1',
      },
      payload: {
        bridgeState: {
          activeClassId: 'demo-class',
          activeAppId: 'weather',
          appContext: {
            weather: {
              appId: 'weather',
              status: 'ready',
              summary: 'Chicago is 72F and sunny.',
              lastState: {
                location: 'Chicago',
                temperatureF: 72,
              },
            },
          },
        },
      },
    })

    assert.equal(saveResponse.statusCode, 200)
    assert.equal(saveResponse.json().bridgeState.activeAppId, 'weather')

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions/session-1/bridge-state',
      headers: {
        authorization: 'Bearer token-1',
      },
    })

    assert.equal(loadResponse.statusCode, 200)
    assert.equal(loadResponse.json().bridgeState.activeAppId, 'weather')
    assert.equal(loadResponse.json().bridgeState.appContext.weather.summary, 'Chicago is 72F and sunny.')
  })
})
