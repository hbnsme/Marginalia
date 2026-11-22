import AliyunSdk, { TranslateGeneralRequest } from '@alicloud/alimt20181012'

// This package is CommonJS: Node ESM's default import is the exports object.
const AliyunMachineTranslationClient = typeof AliyunSdk === 'function' ? AliyunSdk : AliyunSdk.default

const REQUEST_TIMEOUT_MS = 30_000

const aliyunLanguageCodes = new Map([
  ['auto', 'auto'],
  ['en', 'en'],
  ['ja', 'ja'],
  ['fr', 'fr'],
  ['de', 'de'],
  ['zh-CN', 'zh'],
  ['zh', 'zh'],
])

export function toAliyunLanguageCode(language) {
  return aliyunLanguageCodes.get(language) ?? null
}

export function createAliyunTranslationClient({ accessKeyId, accessKeySecret, endpoint }) {
  return new AliyunMachineTranslationClient({
    accessKeyId,
    accessKeySecret,
    endpoint,
    readTimeout: REQUEST_TIMEOUT_MS,
    connectTimeout: REQUEST_TIMEOUT_MS,
  })
}

export async function requestAliyunTranslation(text, sourceLanguage, options = {}) {
  const client = options.client ?? createAliyunTranslationClient({
    accessKeyId: options.accessKeyId ?? process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: options.accessKeySecret ?? process.env.ALIYUN_ACCESS_KEY_SECRET,
    endpoint: options.endpoint ?? process.env.ALIYUN_MT_ENDPOINT,
  })
  const mappedSourceLanguage = toAliyunLanguageCode(sourceLanguage)
  if (!mappedSourceLanguage) {
    const error = new Error('Unsupported source language')
    error.code = 'invalid-language'
    throw error
  }

  const response = await client.translateGeneralWithOptions(new TranslateGeneralRequest({
    formatType: 'text',
    scene: 'general',
    sourceLanguage: mappedSourceLanguage,
    sourceText: text,
    targetLanguage: 'zh',
  }), {
    readTimeout: REQUEST_TIMEOUT_MS,
    connectTimeout: REQUEST_TIMEOUT_MS,
    autoretry: false,
    maxAttempts: 1,
  })

  if (response?.body?.code !== 200) {
    const error = new Error('Alibaba Cloud translation returned an error')
    error.code = 'upstream-error'
    error.upstreamCode = response?.body?.code
    throw error
  }

  const translatedText = response?.body?.data?.translated
  if (typeof translatedText !== 'string' || !translatedText.trim()) {
    const error = new Error('Alibaba Cloud translation returned an invalid result')
    error.code = 'invalid-response'
    throw error
  }
  return translatedText
}
