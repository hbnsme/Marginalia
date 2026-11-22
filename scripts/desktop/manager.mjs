import { randomBytes, createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const HOST = '127.0.0.1'
const VITE_PORT = 5173
const PROXY_PORT = 8788
const VITE_URL = 'http://localhost:5173'
const projectKey = createHash('sha256').update(ROOT.toLowerCase()).digest('hex').slice(0, 24)
const pipePath = `\\\\.\\pipe\\marginalia-${projectKey}`
const stateDir = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ROOT, 'AppData', 'Local'), 'Marginalia', 'launcher')
const statePath = join(stateDir, `${projectKey}.json`)
const logDir = join(stateDir, 'logs')
const logPath = join(logDir, 'launcher.log')
const startedChildren = new Map()
let controlServer
let token
let shuttingDown = false
let startupComplete = false

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  process.stdout.write(line)
  void appendFile(logPath, line).catch(() => undefined)
}

async function ensureDirs() {
  await mkdir(logDir, { recursive: true })
}

async function showNotice(title, message) {
  if (process.env.MARGINALIA_LAUNCHER_TEST_MODE === '1') {
    log(`notice suppressed in test mode: ${title}: ${message}`)
    return
  }
  const escapedTitle = title.replace(/'/g, "''")
  const escapedMessage = message.replace(/'/g, "''")
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escapedMessage}','${escapedTitle}','OK','Warning') | Out-Null`
  await new Promise((resolvePromise) => {
    const popup = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: 'ignore' })
    popup.once('error', resolvePromise)
    popup.once('exit', resolvePromise)
  })
}

function probePort(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: HOST, port })
    const finish = (busy) => {
      socket.destroy()
      resolvePromise(busy)
    }
    socket.setTimeout(600)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function describePortOwner(port) {
  const ps = `$pids = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pidValue in $pids) { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue; if ($p) { $kind = '其他程序'; if ($p.CommandLine -match 'vite(\\.js|/|\\\\)') { $kind = 'Vite/开发服务' } elseif ($p.CommandLine -match 'translationProxy\\.mjs') { $kind = 'Marginalia 翻译代理' }; Write-Output ($p.Name + '（' + $kind + '）') } }`
  return new Promise((resolvePromise) => {
    const query = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let result = ''
    query.stdout.setEncoding('utf8').on('data', (chunk) => { result += chunk })
    query.once('error', () => resolvePromise('未知进程'))
    query.once('exit', () => resolvePromise(result.trim().replace(/[\r\n]+/g, '、') || '未知进程'))
  })
}

async function readState() {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'))
    return value && value.projectKey === projectKey && typeof value.token === 'string' ? value : null
  } catch {
    return null
  }
}

async function writeState() {
  const temporaryPath = `${statePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ projectKey, token, pid: process.pid, startedAt: Date.now() }), { flag: 'wx' })
  await rename(temporaryPath, statePath)
}

async function sendControl(command, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await readState()
    if (state) {
      const connected = await new Promise((resolvePromise) => {
        const socket = createConnection(pipePath)
        let response = ''
        socket.setTimeout(1000)
        socket.once('connect', () => socket.write(`${JSON.stringify({ command, token: state.token })}\n`))
        socket.on('data', (chunk) => { response += chunk.toString('utf8') })
        socket.once('end', () => resolvePromise(response.trim() === 'ok'))
        socket.once('error', () => resolvePromise(false))
        socket.once('timeout', () => { socket.destroy(); resolvePromise(false) })
      })
      if (connected) return true
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  return false
}

function addChild(name, args, extra = {}) {
  const stdout = join(logDir, `${name}.stdout.log`)
  const stderr = join(logDir, `${name}.stderr.log`)
  const child = spawn(NODE, args, {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    ...extra,
  })
  child.stdout?.on('data', (chunk) => { void appendFile(stdout, chunk).catch(() => undefined) })
  child.stderr?.on('data', (chunk) => { void appendFile(stderr, chunk).catch(() => undefined) })
  startedChildren.set(name, child)
  child.once('error', (error) => log(`${name} spawn error: ${error.message}`))
  child.once('exit', (code, signal) => {
    log(`${name} exited code=${code} signal=${signal}`)
    startedChildren.delete(name)
    if (!shuttingDown && startupComplete) void shutdown(`${name} stopped unexpectedly`)
  })
  return child
}

async function waitForHttp(url, child, label, expectedStatus = 200) {
  const deadline = Date.now() + 20_000
  let lastError = 'service did not become ready'
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} process exited before becoming ready`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) })
      if (response.status === expectedStatus) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'connection failed'
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
  }
  throw new Error(`${label} failed readiness check: ${lastError}`)
}

export function openBrowser({ spawnImpl = spawn, logImpl = log, noticeImpl = showNotice } = {}) {
  if (process.env.MARGINALIA_LAUNCHER_TEST_MODE === '1' || process.env.MARGINALIA_LAUNCHER_SKIP_BROWSER === '1') {
    logImpl(`browser launch suppressed in test mode: ${VITE_URL}`)
    return Promise.resolve({ opened: false, suppressed: true })
  }
  return new Promise((resolvePromise) => {
    let settled = false
    const opener = spawnImpl('explorer.exe', [VITE_URL], { windowsHide: true, stdio: 'ignore' })
    opener.once('spawn', () => {
      if (settled) return
      settled = true
      logImpl(`default browser shell launch accepted: ${VITE_URL}`)
      resolvePromise({ opened: true })
    })
    opener.once('error', (error) => {
      if (settled) return
      settled = true
      const code = typeof error?.code === 'string' ? error.code : 'unknown'
      logImpl(`default browser shell launch failed code=${code}`)
      void noticeImpl('Marginalia 已启动', `服务已正常运行，但无法自动打开默认浏览器。请手动访问 ${VITE_URL}`)
      resolvePromise({ opened: false, code })
    })
  })
}

async function requestChildShutdown(name, child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (name !== 'translation-proxy') {
    child.kill()
    await new Promise((resolvePromise) => child.once('exit', resolvePromise))
    return
  }
  if (child.connected) child.send({ type: 'marginalia-shutdown' })
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 38_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    // Kill is applied through the ChildProcess handle we created, never by a stored PID.
    child.kill()
    await new Promise((resolvePromise) => child.once('exit', resolvePromise))
  }
}

async function shutdown(reason = 'requested') {
  if (shuttingDown) return
  shuttingDown = true
  log(`shutdown: ${reason}`)
  const children = [...startedChildren.entries()].reverse()
  await Promise.all(children.map(([name, child]) => requestChildShutdown(name, child)))
  controlServer?.close()
  const state = await readState()
  if (state?.token === token) await rm(statePath, { force: true }).catch(() => undefined)
  process.exit(0)
}

async function startSupervisor() {
  if (await sendControl('open', 1)) {
    openBrowser()
    return 0
  }
  await ensureDirs()
  token = randomBytes(32).toString('hex')
  controlServer = createServer((socket) => {
    let input = ''
    socket.setEncoding('utf8')
    socket.on('data', async (chunk) => {
      input += chunk
      if (!input.includes('\n')) return
      socket.removeAllListeners('data')
      try {
        const message = JSON.parse(input.slice(0, input.indexOf('\n')))
        if (message.token !== token) { socket.end('denied\n'); return }
        socket.end('ok\n')
        if (message.command === 'open') openBrowser()
        if (message.command === 'stop') setTimeout(() => { void shutdown('close shortcut') }, 25)
      } catch {
        socket.end('invalid\n')
      }
    })
  })

  try {
    await new Promise((resolvePromise, reject) => {
      controlServer.once('error', reject)
      controlServer.listen(pipePath, resolvePromise)
    })
  } catch (error) {
    const alreadyRunning = await sendControl('open')
    if (alreadyRunning) { openBrowser(); return 0 }
    log(`control pipe unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
    await showNotice('Marginalia', '无法连接已运行的 Marginalia 启动器。请检查本机启动器日志。')
    return 1
  }

  await writeState()
  process.on('message', (message) => { if (message?.type === 'marginalia-shutdown') void shutdown('parent request') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  log(`supervisor ready project=${projectKey}`)

  for (const port of [VITE_PORT, PROXY_PORT]) {
    if (await probePort(port)) {
      const owner = await describePortOwner(port)
      log(`port ${port} occupied by ${owner}; no external process was stopped`)
      await showNotice('Marginalia 无法启动', `端口 ${port} 已被 ${owner} 占用。启动器没有启动重复服务，也没有结束任何其他程序。请先确认并关闭占用该端口的开发服务后重试。`)
      await shutdown('port conflict')
      return 0
    }
  }

  try {
    const proxyArguments = process.env.MARGINALIA_LAUNCHER_TEST_MODE === '1'
      ? ['scripts/desktop/proxy-test-harness.mjs']
      : ['--env-file-if-exists=.env.local', 'server/translationProxy.mjs']
    const proxy = addChild('translation-proxy', proxyArguments)
    await waitForHttp(`http://${HOST}:${PROXY_PORT}/healthz`, proxy, 'translation proxy')
    const vite = addChild('vite', ['node_modules/vite/bin/vite.js', '--configLoader', 'runner'])
    await waitForHttp(`${VITE_URL}/`, vite, 'Vite')
    startupComplete = true
    log('services ready; opening browser')
    openBrowser()
    await new Promise(() => undefined)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown startup failure'
    log(`startup failed: ${message}`)
    await showNotice('Marginalia 启动失败', `${message}\n启动器未结束任何外部程序。详情见：${logDir}`)
    await shutdown('startup failure')
    return 1
  }
}

async function closeSupervisor() {
  if (await sendControl('stop')) {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (!(await sendControl('status', 1))) return 0
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    }
    await showNotice('Marginalia 仍在关闭', '启动器尚未确认服务全部退出。请稍后检查本机启动器日志。')
    return 1
  }
  await showNotice('Marginalia', '没有找到由此启动器运行的 Marginalia 服务。未结束任何其他程序。')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (command === 'start') process.exitCode = await startSupervisor()
  else if (command === 'stop') process.exitCode = await closeSupervisor()
  else {
    process.stderr.write('Usage: manager.mjs <start|stop>\n')
    process.exitCode = 2
  }
}
