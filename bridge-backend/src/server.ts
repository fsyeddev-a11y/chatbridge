import { createApp } from './app.js'
import { createFileBackedBridgeStore, getDefaultStoreFilePath } from './store.js'

const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '0.0.0.0'
const storePath = process.env.CHATBRIDGE_STORE_PATH || getDefaultStoreFilePath()

const app = createApp({
  store: createFileBackedBridgeStore(storePath),
})

app
  .listen({ port, host })
  .then(() => {
    console.log(`ChatBridge backend listening on http://${host}:${port}`)
    console.log(`ChatBridge store file: ${storePath}`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
