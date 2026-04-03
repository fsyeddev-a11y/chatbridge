import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createApp, getConfiguredAllowedOrigins } from '../src/app.js'
import {
  createFileBackedBridgeStore,
  createInMemoryBridgeStore,
  getAllowedOriginsForLaunchUrl,
  getConfiguredWeatherAppUrl,
} from '../src/store.js'

describe('bridge-backend app', () => {
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
    const app = createApp({ store: createInMemoryBridgeStore() })
    const response = await app.inject({
      method: 'GET',
      url: '/api/classes/demo-class/apps',
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
    const app = createApp({ store: createInMemoryBridgeStore() })
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/events',
      headers: {
        origin: 'http://localhost:3000',
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
    const app = createApp({ store: createInMemoryBridgeStore() })
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/events',
      headers: {
        origin: 'http://localhost:3000',
      },
      payload: {
        source: 'frontend',
      },
    })

    assert.equal(response.statusCode, 400)
    assert.equal(response.json().error, 'validation_error')
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
    assert.equal(response.headers['access-control-allow-methods'], 'GET,POST,OPTIONS')
    assert.equal(response.headers['access-control-allow-headers'], 'Content-Type')
  })

  it('persists seeded store data and appended audit events to disk', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'chatbridge-store-'))
    const storePath = path.join(tempDir, 'bridge-store.json')
    const store = createFileBackedBridgeStore(storePath)

    assert.deepEqual(
      store.listApprovedAppsForClass('demo-class').map((entry) => entry.manifest.appId).sort(),
      ['chess', 'google-classroom', 'weather']
    )

    store.appendAuditEvent({
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
    const weather = store.getRegistryEntry('weather')

    assert.equal(weather?.manifest.launchUrl, 'http://localhost:4173')
    assert.deepEqual(weather?.manifest.allowedOrigins, ['http://localhost:4173'])
    assert.equal(weather?.manifest.heartbeatTimeoutMs, 10000)
  })

  it('registers a new app manifest as pending review', async () => {
    const app = createApp({ store: createInMemoryBridgeStore() })
    const response = await app.inject({
      method: 'POST',
      url: '/api/registry/apps',
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
  })

  it('updates review state and exposes review actions', async () => {
    const store = createInMemoryBridgeStore()
    const app = createApp({ store })

    const reviewResponse = await app.inject({
      method: 'POST',
      url: '/api/registry/apps/chess/review',
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
    })

    assert.equal(actionsResponse.statusCode, 200)
    assert.equal(actionsResponse.json().actions.at(-1)?.appId, 'chess')
    assert.equal(actionsResponse.json().actions.at(-1)?.action, 'suspend')
  })

  it('enables and disables apps per class through the allowlist API', async () => {
    const app = createApp({ store: createInMemoryBridgeStore() })

    const enableResponse = await app.inject({
      method: 'POST',
      url: '/api/classes/algebra-1/allowlist',
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
      payload: {
        enabledBy: 'teacher-1',
      },
    })

    assert.equal(disableResponse.statusCode, 200)
    assert.equal(typeof disableResponse.json().allowlistEntry.disabledAt, 'number')
  })

  it('rejects allowlist enables for apps that are missing or not platform-approved', async () => {
    const app = createApp({ store: createInMemoryBridgeStore() })

    const missingAppResponse = await app.inject({
      method: 'POST',
      url: '/api/classes/algebra-1/allowlist',
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
})
