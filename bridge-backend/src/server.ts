import { createApp } from './app.js'
import { createConfiguredBridgeStore, getConfiguredStoreDriver, getDefaultStoreFilePath } from './store.js'

const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '0.0.0.0'
const storePath = process.env.CHATBRIDGE_STORE_PATH || getDefaultStoreFilePath()
const storeDriver = getConfiguredStoreDriver()

const app = createApp({
  store: createConfiguredBridgeStore(storePath),
})

app
  .listen({ port, host })
  .then(() => {
    console.log(`ChatBridge backend listening on http://${host}:${port}`)
    console.log(`ChatBridge store driver: ${storeDriver}`)
    if (storeDriver === 'file') {
      console.log(`ChatBridge store file: ${storePath}`)
    }
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
