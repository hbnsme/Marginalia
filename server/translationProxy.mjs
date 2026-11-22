import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { requestAliyunTranslation } from './aliyunTranslation.mjs'
import {
  MAX_TRANSLATION_LENGTH,
  TranslationProtectionStore,
  TranslationQuotaError,
  translationCacheKey,
} from './translationProtection.mjs'

const PORT = Number(process.env.TRANSLATION_PORT ?? 8788)
const HOST = '127.0.0.1'
const MAX_TEXT_LENGTH = MAX_TRANSLATION_LENGTH
const MAX_BODY_BYTES = MAX_TEXT_LENGTH * 3 + 1_024
const MAX_CONCURRENT_TRANSLATIONS = 3
const allowedLanguages = new Set(['auto', 'en', 'ja', 'fr', 'de', 'zh-CN', 'zh'])
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://[::1]:4173',
])

export class TranslationProxyError extends Error {
  constructor(publicCode, message, statusCode) {
    super(message)
    this.name = 'TranslationProxyError'
    this.code = publicCode
    this.statusCode = statusCode
  }
}

export function isAllowedTranslationOrigin(origin) {
  if (!origin) return true
  try {
    return allowedOrigins.has(new URL(origin).origin)
  } catch {
    return false
  }
}

export function isAllowedTranslationRequestOrigin(origin, method) {
  if (!origin) return method !== 'POST'
  return isAllowedTranslationOrigin(origin)
}

export function validateTranslationInput(payload) {
  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  const sourceLanguage = payload?.sourceLanguage
  const targetLanguage = payload?.targetLanguage
  const preprocessingVersion = payload?.preprocessingVersion ?? 0
  if (text.length > MAX_TEXT_LENGTH) {
    throw new TranslationProxyError('text-too-long', '单次翻译最多支持 3000 字符，请缩短所选段落。', 400)
  }
  if (!text || !allowedLanguages.has(sourceLanguage) || targetLanguage !== 'zh-CN') {
    throw new TranslationProxyError('invalid-request', '段落内容或语言参数无效。', 400)
  }
  if (!Number.isSafeInteger(preprocessingVersion) || preprocessingVersion < 0 || preprocessingVersion > 1) {
    throw new TranslationProxyError('invalid-request', '翻译预处理版本无效。', 400)
  }
  return { text, sourceLanguage, preprocessingVersion }
}

export function createTranslationProxyServer({
  accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID,
  accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET,
  endpoint = process.env.ALIYUN_MT_ENDPOINT,
  translateImpl = requestAliyunTranslation,
  store = new TranslationProtectionStore(),
} = {}) {
  let activeTranslations = 0
  const inFlightTranslations = new Map()
  const configured = Boolean(accessKeyId && accessKeySecret && endpoint)
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')

    if (!isAllowedTranslationRequestOrigin(request.headers.origin, request.method)) {
      sendJson(response, 403, { error: 'origin-not-allowed', message: '请求来源不受允许。' })
      return
    }

    // Liveness probe used by the Windows desktop launcher; it does not read quota or cache data.
    if (request.method === 'GET' && request.url === '/healthz') {
      sendJson(response, 200, { ok: true, provider: 'aliyun-machine-translation' })
      return
    }

    if (request.method === 'GET' && request.url === '/api/translation/status') {
      sendJson(response, 200, { configured, provider: 'aliyun-machine-translation', usage: store.getUsage() })
      return
    }

    if (request.method !== 'POST' || request.url !== '/api/translate') {
      sendJson(response, 404, { error: 'not-found' })
      return
    }

    if (!configured) {
      sendJson(response, 503, { error: 'service-unconfigured', message: '翻译服务尚未配置。' })
      return
    }

    const contentLength = Number(request.headers['content-length'] ?? 0)
    if (contentLength > MAX_BODY_BYTES) {
      rejectAndCloseRequest(request, response, 413, { error: 'request-too-large', message: '所选段落过长，无法翻译。' })
      return
    }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
      rejectAndCloseRequest(request, response, 415, { error: 'invalid-content-type', message: '请求格式无效。' })
      return
    }

    let payload
    try {
      payload = JSON.parse(await readRequestBody(request, response))
    } catch (error) {
      if (error?.code !== 'request-too-large') {
        sendJson(response, 400, { error: 'invalid-request', message: '无法读取翻译请求。' })
      }
      return
    }

    let input
    try {
      input = validateTranslationInput(payload)
    } catch (error) {
      if (error instanceof TranslationProxyError) sendJson(response, error.statusCode, { error: error.code, message: error.message })
      else sendJson(response, 400, { error: 'invalid-request', message: '翻译请求参数无效。' })
      return
    }

    const cacheKey = translationCacheKey(input.text, input.sourceLanguage, 'zh-CN', input.preprocessingVersion)
    const cachedTranslation = store.getCachedTranslation(cacheKey)
    if (cachedTranslation !== null) {
      sendJson(response, 200, { translatedText: cachedTranslation, cached: true, preprocessingVersion: input.preprocessingVersion, usage: store.getUsage() })
      return
    }

    const existingFlight = inFlightTranslations.get(cacheKey)
    if (existingFlight) {
      try {
        const translatedText = await existingFlight
        sendJson(response, 200, { translatedText, cached: true, preprocessingVersion: input.preprocessingVersion, usage: store.getUsage() })
      } catch {
        sendJson(response, 502, { error: 'upstream-failed', message: '翻译服务请求失败，请检查配置或稍后重试。' })
      }
      return
    }

    if (activeTranslations >= MAX_CONCURRENT_TRANSLATIONS) {
      sendJson(response, 429, { error: 'too-many-requests', message: '翻译请求较多，请稍后重试。', usage: store.getUsage() })
      return
    }

    let usage
    try {
      usage = store.reserveUsage(input.text.length)
    } catch (error) {
      if (error instanceof TranslationQuotaError) {
        sendJson(response, error.statusCode, { error: error.code, message: error.message, usage: error.usage })
      } else {
        sendJson(response, 500, { error: 'usage-store-failed', message: '无法记录翻译用量，请重启本机代理后重试。' })
      }
      return
    }

    activeTranslations += 1
    const translationFlight = Promise.resolve().then(() => translateImpl(input.text, input.sourceLanguage, {
      accessKeyId,
      accessKeySecret,
      endpoint,
    })).then((translatedText) => {
      store.saveTranslation(cacheKey, input.sourceLanguage, 'zh-CN', translatedText)
      return translatedText
    })
    inFlightTranslations.set(cacheKey, translationFlight)
    try {
      const translatedText = await translationFlight
      sendJson(response, 200, { translatedText, cached: false, preprocessingVersion: input.preprocessingVersion, usage })
    } catch (error) {
      if (error instanceof TranslationProxyError) {
        sendJson(response, error.statusCode, { error: error.code, message: error.message })
      } else {
        const invalidResponse = error?.code === 'invalid-response'
        const throttled = error?.code === 'Throttling' || error?.statusCode === 429 || error?.status === 429
        console.error('[translation-proxy] upstream failure', {
          errorType: safeLogToken(error?.name ?? error?.constructor?.name ?? typeof error),
          errorCode: safeLogToken(error?.code),
          httpStatus: safeHttpStatus(error?.statusCode ?? error?.status ?? error?.response?.statusCode),
          requestId: safeRequestId(error?.requestId ?? error?.RequestId ?? error?.response?.body?.requestId ?? error?.data?.RequestId),
        })
        sendJson(response, throttled ? 429 : 502, {
          error: invalidResponse ? 'invalid-response' : 'upstream-failed',
          message: invalidResponse ? '翻译服务返回了无效结果。' : '翻译服务请求失败，请检查配置或稍后重试。',
        })
      }
    } finally {
      activeTranslations -= 1
      inFlightTranslations.delete(cacheKey)
    }
  })
}

function safeLogToken(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const token = String(value)
  return /^[A-Za-z0-9_.-]{1,80}$/.test(token) ? token : null
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null
}

function safeRequestId(value) {
  if (typeof value !== 'string') return null
  return /^[A-Za-z0-9-]{1,100}$/.test(value) ? value : null
}

function sendJson(response, statusCode, data) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(statusCode)
  response.end(JSON.stringify(data))
}

function rejectAndCloseRequest(request, response, statusCode, payload) {
  sendJson(response, statusCode, payload)
  response.once('finish', () => request.destroy())
}

function readRequestBody(request, response) {
  return new Promise((resolve, reject) => {
    let body = ''
    let byteLength = 0
    let tooLarge = false
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      if (tooLarge) return
      byteLength += Buffer.byteLength(chunk, 'utf8')
      if (byteLength > MAX_BODY_BYTES) {
        tooLarge = true
        rejectAndCloseRequest(request, response, 413, { error: 'request-too-large', message: '所选段落过长，无法翻译。' })
        reject(Object.assign(new Error('request-too-large'), { code: 'request-too-large' }))
        return
      }
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = new TranslationProtectionStore()
  const server = createTranslationProxyServer({ store })
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    const forceTimer = setTimeout(() => {
      store.close()
      process.exit(1)
    }, 35_000)
    forceTimer.unref()
    server.close(() => {
      clearTimeout(forceTimer)
      store.close()
      process.exit(0)
    })
  }
  process.on('message', (message) => { if (message?.type === 'marginalia-shutdown') shutdown() })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  server.listen(PORT, HOST, () => {
    process.stdout.write(`Translation proxy listening on http://${HOST}:${PORT}\n`)
  })
}
