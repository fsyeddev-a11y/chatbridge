import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBridge, isHostEnvelope } from '../src/bridge.js'

describe('chess-app bridge', () => {
  it('recognizes valid host envelopes', () => {
    assert.equal(
      isHostEnvelope(
        {
          source: 'chatbridge-host',
          version: '1.0',
          appId: 'chess-app',
          type: 'INIT',
        },
        'chess-app'
      ),
      true
    )

    assert.equal(isHostEnvelope({ source: 'chatbridge-host', appId: 'chess-app' }, 'chess-app'), false)
  })

  it('sends heartbeat when the host pings the app', () => {
    const events = []
    const listeners = new Map()
    global.window = {
      parent: {
        postMessage(message) {
          events.push(message)
        },
      },
      addEventListener(type, handler) {
        listeners.set(type, handler)
      },
      removeEventListener(type) {
        listeners.delete(type)
      },
    }

    const bridge = createBridge({ appId: 'chess-app' })

    listeners.get('message')({
      data: {
        source: 'chatbridge-host',
        version: '1.0',
        appId: 'chess-app',
        type: 'PING',
      },
    })

    assert.deepEqual(events.at(-1), {
      source: 'chatbridge-app',
      version: '1.0',
      appId: 'chess-app',
      type: 'HEARTBEAT',
      payload: undefined,
    })

    bridge.destroy()
    delete global.window
  })
})
