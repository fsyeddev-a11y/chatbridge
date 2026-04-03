const APP_SOURCE = 'chatbridge-app'
const HOST_SOURCE = 'chatbridge-host'
const PROTOCOL_VERSION = '1.0'

function buildAppEnvelope(appId, type, payload) {
  return {
    source: APP_SOURCE,
    version: PROTOCOL_VERSION,
    appId,
    type,
    payload,
  }
}

export function isHostEnvelope(data, appId) {
  return (
    !!data &&
    typeof data === 'object' &&
    data.source === HOST_SOURCE &&
    data.version === PROTOCOL_VERSION &&
    data.appId === appId &&
    typeof data.type === 'string'
  )
}

export function createBridge({ appId, onInit, onPing, onTerminate }) {
  if (!appId) {
    throw new Error('createBridge requires an appId')
  }

  const hostState = {
    initialized: false,
    initPayload: undefined,
  }

  function post(type, payload) {
    window.parent.postMessage(buildAppEnvelope(appId, type, payload), '*')
  }

  function handleHostMessage(event) {
    if (!isHostEnvelope(event.data, appId)) {
      return
    }

    switch (event.data.type) {
      case 'INIT':
        hostState.initialized = true
        hostState.initPayload = event.data.payload
        onInit?.(event.data.payload)
        break
      case 'PING':
        post('HEARTBEAT')
        onPing?.()
        break
      case 'TERMINATE':
        onTerminate?.(event.data.payload)
        break
      default:
        break
    }
  }

  window.addEventListener('message', handleHostMessage)

  return {
    getHostState() {
      return hostState
    },
    sendReady(summary) {
      post('APP_READY', summary ? { summary } : undefined)
    },
    sendStateUpdate(summary, state) {
      post('STATE_UPDATE', {
        summary,
        state,
      })
    },
    sendComplete(summary, state) {
      post('APP_COMPLETE', {
        summary,
        state,
      })
    },
    sendError(error) {
      post('APP_ERROR', {
        error,
      })
    },
    destroy() {
      window.removeEventListener('message', handleHostMessage)
    },
  }
}
