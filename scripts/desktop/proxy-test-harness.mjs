import { fileURLToPath } from 'node:url'
import { TranslationProtectionStore } from '../../server/translationProtection.mjs'
import { createTranslationProxyServer } from '../../server/translationProxy.mjs'

// Isolated launcher integration target: no .env file, credentials, real DB, or upstream requests.
const store = new TranslationProtectionStore({ dbPath: ':memory:' })
const server = createTranslationProxyServer({
  accessKeyId: '',
  accessKeySecret: '',
  endpoint: '',
  store,
  translateImpl: async () => { throw new Error('Test harness must never call a translation provider.') },
})
let closing = false

function close() {
  if (closing) return
  closing = true
  server.close(() => {
    store.close()
    process.exit(0)
  })
}

process.on('message', (message) => { if (message?.type === 'marginalia-shutdown') close() })
process.on('SIGINT', close)
process.on('SIGTERM', close)

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(8788, '127.0.0.1', () => process.stdout.write('Isolated launcher test proxy ready.\n'))
}
