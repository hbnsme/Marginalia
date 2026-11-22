import { describe, expect, it } from 'vitest'
import {
  isAllowedTranslationOrigin,
  isAllowedTranslationRequestOrigin,
  createTranslationProxyServer,
  TranslationProxyError,
  validateTranslationInput,
} from '../../../server/translationProxy.mjs'
import { createAliyunTranslationClient, requestAliyunTranslation, toAliyunLanguageCode } from '../../../server/aliyunTranslation.mjs'
import { TranslationProtectionStore } from '../../../server/translationProtection.mjs'
import { vi } from 'vitest'

describe('translation proxy validation', () => {
  it('accepts only the configured local app origins', () => {
    expect(isAllowedTranslationOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedTranslationOrigin('http://localhost:4173')).toBe(true)
    expect(isAllowedTranslationOrigin('http://localhost:5174')).toBe(false)
    expect(isAllowedTranslationOrigin('https://example.com')).toBe(false)
    expect(isAllowedTranslationOrigin('not a URL')).toBe(false)
    expect(isAllowedTranslationOrigin(undefined)).toBe(true)
    expect(isAllowedTranslationRequestOrigin(undefined, 'GET')).toBe(true)
    expect(isAllowedTranslationRequestOrigin(undefined, 'POST')).toBe(false)
  })

  it('accepts one bounded paragraph and supported language codes only', () => {
    expect(validateTranslationInput({ text: '  Selected paragraph.  ', sourceLanguage: 'en', targetLanguage: 'zh-CN' }))
      .toEqual({ text: 'Selected paragraph.', sourceLanguage: 'en', preprocessingVersion: 0 })
    expect(validateTranslationInput({ text: 'text', sourceLanguage: 'auto', targetLanguage: 'zh-CN' }))
      .toEqual({ text: 'text', sourceLanguage: 'auto', preprocessingVersion: 0 })
    expect(validateTranslationInput({ text: 'text', sourceLanguage: 'zh-CN', targetLanguage: 'zh-CN' }))
      .toEqual({ text: 'text', sourceLanguage: 'zh-CN', preprocessingVersion: 0 })
    expect(validateTranslationInput({ text: 'x'.repeat(3_000), sourceLanguage: 'ja', targetLanguage: 'zh-CN' }).text).toHaveLength(3_000)
    expect(() => validateTranslationInput({ text: 'x'.repeat(3_001), sourceLanguage: 'ja', targetLanguage: 'zh-CN' }))
      .toThrowError(expect.objectContaining({ code: 'text-too-long', statusCode: 400 }))
    expect(() => validateTranslationInput({ text: '', sourceLanguage: 'en', targetLanguage: 'zh-CN' })).toThrowError(TranslationProxyError)
    expect(() => validateTranslationInput({ text: 'text', sourceLanguage: 'xx', targetLanguage: 'zh-CN' })).toThrowError(TranslationProxyError)
    expect(() => validateTranslationInput({ text: 'text', sourceLanguage: 'ja', targetLanguage: 'en' })).toThrowError(TranslationProxyError)
    expect(() => validateTranslationInput({ text: 'x'.repeat(5_001), sourceLanguage: 'ja', targetLanguage: 'zh-CN' })).toThrowError(TranslationProxyError)
  })
})

describe('local translation proxy contract', () => {
  it('exposes a database-free launcher health endpoint', async () => {
    const store = { getUsage: vi.fn(() => { throw new Error('health probe must not read usage') }) }
    const server = createTranslationProxyServer({ accessKeyId: '', accessKeySecret: '', endpoint: '', store })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, provider: 'aliyun-machine-translation' })
      expect(store.getUsage).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('keeps /api/translate request and response shape while using a mocked provider', async () => {
    let received: { text: string; sourceLanguage: string } | undefined
    const store = new TranslationProtectionStore({ dbPath: ':memory:' })
    const server = createTranslationProxyServer({
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
      endpoint: 'mock.endpoint.invalid',
      translateImpl: async (text, sourceLanguage) => {
        received = { text, sourceLanguage }
        return '本地 mock 译文。'
      },
      store,
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/translate`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Selected paragraph.', sourceLanguage: 'en', targetLanguage: 'zh-CN', preprocessingVersion: 1 }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ translatedText: '本地 mock 译文。', cached: false, usage: { characters: 19, requests: 1 } })
      expect(received).toEqual({ text: 'Selected paragraph.', sourceLanguage: 'en' })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      store.close()
    }
  })

  it('returns safe errors for unconfigured service and upstream failure', async () => {
    const unconfiguredStore = new TranslationProtectionStore({ dbPath: ':memory:' })
    const unconfiguredServer = createTranslationProxyServer({ accessKeyId: '', accessKeySecret: '', endpoint: '', store: unconfiguredStore })
    await new Promise<void>((resolve) => unconfiguredServer.listen(0, '127.0.0.1', resolve))
    const unconfiguredAddress = unconfiguredServer.address()
    if (!unconfiguredAddress || typeof unconfiguredAddress === 'string') throw new Error('Expected an ephemeral TCP address')
    try {
      const response = await fetch(`http://127.0.0.1:${unconfiguredAddress.port}/api/translate`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Text.', sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: 'service-unconfigured' })
    } finally {
      await new Promise<void>((resolve, reject) => unconfiguredServer.close((error) => error ? reject(error) : resolve()))
      unconfiguredStore.close()
    }

    const failingStore = new TranslationProtectionStore({ dbPath: ':memory:' })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingServer = createTranslationProxyServer({
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
      endpoint: 'mock.endpoint.invalid',
      translateImpl: async () => { throw new Error('fixture-secret Selected private paragraph') },
      store: failingStore,
    })
    await new Promise<void>((resolve) => failingServer.listen(0, '127.0.0.1', resolve))
    const failingAddress = failingServer.address()
    if (!failingAddress || typeof failingAddress === 'string') throw new Error('Expected an ephemeral TCP address')
    try {
      const response = await fetch(`http://127.0.0.1:${failingAddress.port}/api/translate`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Text.', sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      })
      const payload = await response.json()
      expect(response.status).toBe(502)
      expect(payload).toMatchObject({ error: 'upstream-failed' })
      expect(JSON.stringify(payload)).not.toContain('fixture-secret')
      const logged = JSON.stringify(errorLog.mock.calls)
      expect(logged).not.toContain('fixture-secret')
      expect(logged).not.toContain('Selected private paragraph')
      expect(failingStore.getUsage()).toMatchObject({ characters: 5, requests: 1 })
    } finally {
      errorLog.mockRestore()
      await new Promise<void>((resolve, reject) => failingServer.close((error) => error ? reject(error) : resolve()))
      failingStore.close()
    }
  })

  it('returns explicit daily limit codes with Beijing reset time', async () => {
    const store = new TranslationProtectionStore({ dbPath: ':memory:', now: () => new Date('2026-11-02T15:00:00.000Z') })
    store.reserveUsage(20_000)
    const server = createTranslationProxyServer({
      accessKeyId: 'fixture-id', accessKeySecret: 'fixture-secret', endpoint: 'mock.endpoint.invalid', store,
      translateImpl: async () => 'must not be called',
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/translate`, {
        method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x', sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      })
      const payload = await response.json()
      expect(response.status).toBe(429)
      expect(payload).toMatchObject({ error: 'daily-character-limit', usage: { remainingCharacters: 0 } })
      expect(payload.message).toContain('北京时间')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      store.close()
    }
  })

  it('serves cached text without spending quota and shares concurrent identical requests', async () => {
    const store = new TranslationProtectionStore({ dbPath: ':memory:' })
    let upstreamCalls = 0
    const server = createTranslationProxyServer({
      accessKeyId: 'fixture-id', accessKeySecret: 'fixture-secret', endpoint: 'mock.endpoint.invalid', store,
      translateImpl: async () => {
        upstreamCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 25))
        return 'cached result'
      },
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
    const request = () => fetch(`http://127.0.0.1:${address.port}/api/translate`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'same paragraph', sourceLanguage: 'en', targetLanguage: 'zh-CN', preprocessingVersion: 1 }),
    })
    try {
      const simultaneous = await Promise.all([request(), request(), request()])
      for (const response of simultaneous) expect(response.status).toBe(200)
      expect(upstreamCalls).toBe(1)
      expect(store.getUsage()).toMatchObject({ characters: 14, requests: 1 })
      const cacheHit = await request()
      expect(await cacheHit.json()).toMatchObject({ translatedText: 'cached result', cached: true })
      expect(upstreamCalls).toBe(1)
      expect(store.getUsage()).toMatchObject({ characters: 14, requests: 1 })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      store.close()
    }
  })

  it('isolates proxy cache entries by preprocessing version and reserves quota for a new version', async () => {
    const store = new TranslationProtectionStore({ dbPath: ':memory:' })
    let upstreamCalls = 0
    const server = createTranslationProxyServer({
      accessKeyId: 'fixture-id', accessKeySecret: 'fixture-secret', endpoint: 'mock.endpoint.invalid', store,
      translateImpl: async () => `result-${++upstreamCalls}`,
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
    const request = (preprocessingVersion: number) => fetch(`http://127.0.0.1:${address.port}/api/translate`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'same prepared text', sourceLanguage: 'en', targetLanguage: 'zh-CN', preprocessingVersion }),
    })
    try {
      expect(await (await request(0)).json()).toMatchObject({ translatedText: 'result-1', cached: false, preprocessingVersion: 0 })
      expect(await (await request(1)).json()).toMatchObject({ translatedText: 'result-2', cached: false, preprocessingVersion: 1 })
      expect(await (await request(1)).json()).toMatchObject({ translatedText: 'result-2', cached: true, preprocessingVersion: 1 })
      expect(upstreamCalls).toBe(2)
      expect(store.getUsage()).toMatchObject({ requests: 2, characters: 36 })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      store.close()
    }
  })
})

describe('Alibaba Cloud TranslateGeneral adapter', () => {
  it('initializes the installed SDK Client and invokes its method through a mock', async () => {
    const client = createAliyunTranslationClient({
      accessKeyId: 'fixture-id',
      accessKeySecret: 'fixture-secret',
      endpoint: 'mock.endpoint.invalid',
    })
    expect(client).toBeDefined()
    expect(typeof client.translateGeneralWithOptions).toBe('function')

    let called = false
    client.translateGeneralWithOptions = async () => {
      called = true
      return { body: { code: 200, data: { translated: 'mock result' } } }
    }
    await expect(requestAliyunTranslation('Mock source.', 'en', { client }))
      .resolves.toBe('mock result')
    expect(called).toBe(true)
  })

  it('maps language codes and rejects unknown codes', () => {
    expect(toAliyunLanguageCode('auto')).toBe('auto')
    expect(toAliyunLanguageCode('en')).toBe('en')
    expect(toAliyunLanguageCode('ja')).toBe('ja')
    expect(toAliyunLanguageCode('zh-CN')).toBe('zh')
    expect(toAliyunLanguageCode('xx')).toBeNull()
  })

  it('sends TranslateGeneral parameters and maps Data.Translated to translatedText', async () => {
    let capturedRequest: Record<string, unknown> | undefined
    const translatedText = await requestAliyunTranslation('Selected Japanese text.', 'ja', {
      client: {
        async translateGeneralWithOptions(request: Record<string, unknown>) {
          capturedRequest = request
          return { body: { code: 200, data: { translated: '日文对应译文。' } } }
        },
      },
    })
    expect(translatedText).toBe('日文对应译文。')
    expect(capturedRequest).toMatchObject({
      formatType: 'text',
      scene: 'general',
      sourceLanguage: 'ja',
      sourceText: 'Selected Japanese text.',
      targetLanguage: 'zh',
    })
  })

  it('maps zh-CN to zh and preserves auto for API auto detection', async () => {
    const requestedLanguages: string[] = []
    const client = { async translateGeneralWithOptions(request: { sourceLanguage: string }) {
      requestedLanguages.push(request.sourceLanguage)
      return { body: { code: 200, data: { translated: '译文' } } }
    } }
    await requestAliyunTranslation('Text.', 'zh-CN', { client })
    await requestAliyunTranslation('Text.', 'auto', { client })
    expect(requestedLanguages).toEqual(['zh', 'auto'])
  })

  it('surfaces upstream errors and rejects malformed responses', async () => {
    await expect(requestAliyunTranslation('Paragraph.', 'en', {
      client: { async translateGeneralWithOptions() { throw new Error('network failure') } },
    })).rejects.toMatchObject({ message: 'network failure' })
    await expect(requestAliyunTranslation('Paragraph.', 'en', {
      client: { async translateGeneralWithOptions() { return { body: { code: 10009 } } } },
    })).rejects.toMatchObject({ code: 'upstream-error' })
    await expect(requestAliyunTranslation('Paragraph.', 'en', {
      client: { async translateGeneralWithOptions() { return { body: { code: 200, data: { translated: '' } } } } },
    })).rejects.toMatchObject({ code: 'invalid-response' })
  })
})

