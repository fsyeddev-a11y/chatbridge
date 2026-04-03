import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../src/app.js'

describe('bridge-backend app', () => {
  it('returns health status', async () => {
    const app = createApp()
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

  it('returns approved apps for a class from backend-owned allowlist state', async () => {
    const app = createApp()
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
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/events',
      payload: {
        timestamp: Date.now(),
        traceId: 'trace-1',
        eventType: 'GenerationStarted',
        source: 'frontend',
        sessionId: 'session-1',
      },
    })

    assert.equal(response.statusCode, 202)
    const payload = response.json()
    assert.equal(payload.accepted, true)
    assert.equal(payload.event.traceId, 'trace-1')
    assert.equal(payload.event.eventType, 'GenerationStarted')
    assert.equal(payload.event.source, 'frontend')
  })

  it('rejects invalid audit events', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/events',
      payload: {
        source: 'frontend',
      },
    })

    assert.equal(response.statusCode, 400)
    assert.equal(response.json().error, 'validation_error')
  })
})
