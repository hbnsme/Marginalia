import { describe, expect, it } from 'vitest'
import type { PdfParagraph } from '../pdf/pdfTypes'
import {
  createTranslationRecord,
  createTranslationRequest,
  canApplyTranslationResult,
  aliyunTranslationProvider,
  mergeTranslationRecord,
  translationRecordKey,
  TranslationError,
  unconfiguredTranslationProvider,
  translateSelectionText,
} from './translationProvider'

const paragraph: PdfParagraph = {
  id: `sha256:${'c'.repeat(64)}:page:2:paragraph:1`,
  documentId: `sha256:${'c'.repeat(64)}`,
  pageNumber: 2,
  paragraphIndex: 1,
  text: 'The original English paragraph remains unchanged.',
  sourceTextHash: 'source-checksum',
  pageBounds: { coordinateSystem: 'pdf-user-space', x: 10, y: 20, width: 100, height: 30 },
  items: [],
}

describe('translation provider boundary', () => {
  it('submits only normalized selected text and returns a transient selection result', async () => {
    const originalFetch = globalThis.fetch
    let requestBody: Record<string, unknown> | null = null
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ translatedText: '选中文字译文', cached: false }), { status: 200 })
    }
    try {
      const result = await translateSelectionText('  selected\n  term  ', 'en')
      expect(requestBody).toMatchObject({ text: 'selected term', sourceLanguage: 'en', targetLanguage: 'zh-CN' })
      expect(result.translatedText).toBe('选中文字译文')
      expect(result.paragraphId).toMatch(/^selection:/)
    } finally { globalThis.fetch = originalFetch }
  })

  it('rejects oversized selections before making a request', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('unexpected network request') }
    try {
      await expect(translateSelectionText('x'.repeat(3001), 'en')).rejects.toMatchObject({ code: 'invalid-response' })
      expect(fetchCalls).toBe(0)
    } finally { globalThis.fetch = originalFetch }
  })
  it('keeps original text intact and records a translation against its paragraph ID', () => {
    const originalText = paragraph.text
    const request = createTranslationRequest(paragraph, 'en')
    const translation = createTranslationRecord(paragraph, {
      paragraphId: request.paragraphId,
      sourceTextHash: request.sourceTextHash,
      translatedText: '对应的中文译文。',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      createdAt: 123,
      preprocessingVersion: request.preprocessingVersion,
    })
    expect(translation).toMatchObject({
      documentId: paragraph.documentId,
      paragraphId: paragraph.id,
      sourceTextHash: paragraph.sourceTextHash,
      targetLanguage: 'zh-CN',
      translatedText: '对应的中文译文。',
    })
    expect(paragraph.text).toBe(originalText)
  })

  it('rejects a translation response linked to another paragraph', () => {
    expect(() => createTranslationRecord(paragraph, {
      paragraphId: 'another-paragraph',
      sourceTextHash: paragraph.sourceTextHash,
      translatedText: '不应关联到此段的译文。',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      createdAt: 123,
      preprocessingVersion: 1,
    })).toThrowError(TranslationError)
  })

  it('exposes the unconfigured state and performs no external request', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = async () => {
      fetchCalls += 1
      throw new Error('fetch must not be called')
    }
    try {
      expect(unconfiguredTranslationProvider.status).toBe('unconfigured')
      await expect(unconfiguredTranslationProvider.translate(createTranslationRequest(paragraph, 'en')))
        .rejects.toMatchObject({ code: 'service-unconfigured', message: '翻译服务尚未配置。' })
      expect(fetchCalls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it.each([
    ['en', 'English source paragraph.'],
    ['ja', '日本語の原文段落です。'],
  ] as const)('submits only the selected %s paragraph and returns its linked translation', async (language, sourceText) => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> | undefined
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ translatedText: '真实服务返回的译文。' }), { status: 200 })
    }
    try {
      const request = { ...createTranslationRequest(paragraph, language), sourceText }
      const result = await aliyunTranslationProvider.translate(request)
      expect(capturedUrl).toBe('/api/translate')
      expect(capturedBody).toEqual({ text: sourceText, sourceLanguage: language, targetLanguage: 'zh-CN', preprocessingVersion: 1 })
      expect(JSON.stringify(capturedBody)).not.toContain(paragraph.documentId)
      expect(result).toMatchObject({ paragraphId: paragraph.id, sourceTextHash: paragraph.sourceTextHash, sourceLanguage: language, translatedText: '真实服务返回的译文。', preprocessingVersion: 1, translationSource: 'upstream' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('marks proxy SQLite cache hits separately from upstream results', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ translatedText: '缓存译文。', cached: true, preprocessingVersion: 1 }), { status: 200 })
    try {
      await expect(aliyunTranslationProvider.translate(createTranslationRequest(paragraph, 'en')))
        .resolves.toMatchObject({ translatedText: '缓存译文。', translationSource: 'proxy-cache', preprocessingVersion: 1 })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps other paragraph translations and keys records by paragraph and language', () => {
    const englishTranslation = createTranslationRecord(paragraph, {
      paragraphId: paragraph.id,
      sourceTextHash: paragraph.sourceTextHash,
      translatedText: 'Existing English translation.',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      createdAt: 123,
      preprocessingVersion: 1,
    })
    const japaneseTranslation = { ...englishTranslation, id: `${paragraph.id}:ja`, sourceLanguage: 'ja' as const, translatedText: '已有日文译文。' }
    const englishKey = translationRecordKey(paragraph.id, 'en')
    const japaneseKey = translationRecordKey(paragraph.id, 'ja')
    const records = mergeTranslationRecord({ [englishKey]: englishTranslation }, japaneseKey, japaneseTranslation)
    expect(records[englishKey]).toBe(englishTranslation)
    expect(records[japaneseKey]).toBe(japaneseTranslation)
  })

  it('rejects results from a previous document generation', () => {
    expect(canApplyTranslationResult(paragraph.documentId, paragraph.documentId, 4, 4)).toBe(true)
    expect(canApplyTranslationResult(paragraph.documentId, `sha256:${'d'.repeat(64)}`, 4, 4)).toBe(false)
    expect(canApplyTranslationResult(paragraph.documentId, paragraph.documentId, 4, 5)).toBe(false)
  })

  it('surfaces an unconfigured proxy response without creating fake text', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'service-unconfigured' }), { status: 503 })
    try {
      await expect(aliyunTranslationProvider.translate(createTranslationRequest(paragraph, 'en')))
        .rejects.toMatchObject({ code: 'service-unconfigured' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps provider errors retryable and does not treat them as successful translations', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'temporary upstream error' }), { status: 502 })
    try {
      await expect(aliyunTranslationProvider.translate(createTranslationRequest(paragraph, 'en')))
        .rejects.toMatchObject({ code: 'request-failed', message: 'temporary upstream error' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('allows the same paragraph request to be retried after a failed attempt', async () => {
    const originalFetch = globalThis.fetch
    let attempts = 0
    globalThis.fetch = async () => {
      attempts += 1
      return attempts === 1
        ? new Response(JSON.stringify({ message: 'temporary error' }), { status: 502 })
        : new Response(JSON.stringify({ translatedText: '重试成功的译文。' }), { status: 200 })
    }
    try {
      const request = createTranslationRequest(paragraph, 'en')
      await expect(aliyunTranslationProvider.translate(request)).rejects.toMatchObject({ code: 'request-failed' })
      await expect(aliyunTranslationProvider.translate(request)).resolves.toMatchObject({ translatedText: '重试成功的译文。' })
      expect(attempts).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

