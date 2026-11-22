import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { openBrowser } from './manager.mjs'

test('opens the fixed local URL through Windows Shell', async () => {
  const previousTestMode = process.env.MARGINALIA_LAUNCHER_TEST_MODE
  const previousSkipBrowser = process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER
  delete process.env.MARGINALIA_LAUNCHER_TEST_MODE
  delete process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER
  try {
    let invocation
    const child = new EventEmitter()
    const resultPromise = openBrowser({
      spawnImpl: (...args) => { invocation = args; queueMicrotask(() => child.emit('spawn')); return child },
      logImpl: () => undefined,
      noticeImpl: () => undefined,
    })
    assert.deepEqual(await resultPromise, { opened: true })
    assert.equal(invocation[0], 'explorer.exe')
    assert.deepEqual(invocation[1], ['http://localhost:5173'])
    assert.deepEqual(invocation[2], { windowsHide: true, stdio: 'ignore' })
  } finally {
    if (previousTestMode === undefined) delete process.env.MARGINALIA_LAUNCHER_TEST_MODE
    else process.env.MARGINALIA_LAUNCHER_TEST_MODE = previousTestMode
    if (previousSkipBrowser === undefined) delete process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER
    else process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER = previousSkipBrowser
  }
})

test('reports shell launch failure without throwing or affecting services', async () => {
  const previousTestMode = process.env.MARGINALIA_LAUNCHER_TEST_MODE
  const previousSkipBrowser = process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER
  delete process.env.MARGINALIA_LAUNCHER_TEST_MODE
  delete process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER
  try {
    const child = new EventEmitter()
    const logs = []
    const notices = []
    const resultPromise = openBrowser({
      spawnImpl: () => { queueMicrotask(() => { const error = new Error('not logged'); error.code = 'ENOENT'; child.emit('error', error) }); return child },
      logImpl: (message) => logs.push(message),
      noticeImpl: (...args) => notices.push(args),
    })
    assert.deepEqual(await resultPromise, { opened: false, code: 'ENOENT' })
    assert.equal(logs.length, 1)
    assert.match(logs[0], /code=ENOENT/)
    assert.doesNotMatch(logs[0], /not logged/)
    assert.equal(notices.length, 1)
    assert.match(notices[0][1], /http:\/\/localhost:5173/)
  } finally {
    if (previousTestMode === undefined) delete process.env.MARGINALIA_LAUNCHER_TEST_MODE
    else process.env.MARGINALIA_LAUNCHER_TEST_MODE = previousTestMode
    if (previousSkipBrowser === undefined) delete process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER
    else process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER = previousSkipBrowser
  }
})
