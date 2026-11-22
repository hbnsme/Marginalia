import { createServer } from 'node:net'

const server = createServer()
server.listen(5173, '127.0.0.1', () => process.stdout.write('Test-only port occupant ready.\n'))
server.on('error', (error) => {
  process.stderr.write(`Test-only listener failed: ${error.code ?? 'unknown'}\n`)
  process.exitCode = 1
})
