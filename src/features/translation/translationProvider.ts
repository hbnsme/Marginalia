import type { DocumentId, PdfParagraph, SourceLanguage, TargetLanguage, TranslationRecord } from '../pdf/pdfTypes'
import { prepareTranslationText, TRANSLATION_PREPROCESSING_VERSION } from './translationText'
import { versionedTranslationRecordId } from '../pdf/readerResultsStore'

export type TranslationRequest = {
  documentId: DocumentId
  paragraphId: string
  sourceText: string
  sourceTextHash: string
  sourceLanguage: SourceLanguage
  targetLanguage: TargetLanguage
  preprocessingVersion: number
}

export type TranslationResult = {
  paragraphId: string
  sourceTextHash: string
  translatedText: string
  sourceLanguage: SourceLanguage
  targetLanguage: TargetLanguage
  createdAt: number
  preprocessingVersion: number
  translationSource?: 'proxy-cache' | 'upstream'
}

export type TranslationProviderStatus = 'ready' | 'unconfigured'
export type TranslationErrorCode = 'service-unconfigured' | 'request-failed' | 'invalid-response'
export type TranslationQuota = {
  day: string
  characters: number
  requests: number
  characterLimit: number
  requestLimit: number
  remainingCharacters: number
  remainingRequests: number
  resetAt: string
}

export class TranslationError extends Error {
  constructor(public readonly code: TranslationErrorCode, message: string) {
    super(message)
    this.name = 'TranslationError'
  }
}

/** Provider implementations live outside the PDF.js layer. */
export interface TranslationProvider {
  readonly status: TranslationProviderStatus
  translate(request: TranslationRequest): Promise<TranslationResult>
}

/** Stage 3A provider: intentionally performs no network request and returns no fake text. */
export const unconfiguredTranslationProvider: TranslationProvider = {
  status: 'unconfigured',
  async translate(_request) {
    throw new TranslationError('service-unconfigured', '翻译服务尚未配置。')
  },
}

/** Browser client for the local proxy; Alibaba Cloud credentials stay on the local server. */
export const aliyunTranslationProvider: TranslationProvider = {
  status: 'ready',
  async translate(request) {
    if (!request.sourceText.trim()) {
      throw new TranslationError('invalid-response', '原文段落为空，无法翻译。')
    }

    let response: Response
    try {
      response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: request.sourceText,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          preprocessingVersion: request.preprocessingVersion,
        }),
      })
    } catch {
      throw new TranslationError('request-failed', '无法连接本机翻译代理，请确认翻译服务已启动。')
    }

    const payload = await response.json().catch(() => null) as { translatedText?: unknown; error?: string; message?: string; cached?: unknown } | null
    if (response.status === 503 || payload?.error === 'service-unconfigured') {
      throw new TranslationError('service-unconfigured', '翻译服务尚未配置。请在本机代理中配置阿里云机器翻译凭据和 endpoint。')
    }
    if (!response.ok) {
      throw new TranslationError('request-failed', payload?.message ?? '翻译失败，请稍后重试。')
    }
    if (typeof payload?.translatedText !== 'string' || !payload.translatedText.trim()) {
      throw new TranslationError('invalid-response', '翻译服务返回了无效结果。')
    }

    return {
      paragraphId: request.paragraphId,
      sourceTextHash: request.sourceTextHash,
      translatedText: payload.translatedText,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      createdAt: Date.now(),
      preprocessingVersion: request.preprocessingVersion,
      translationSource: payload.cached === true ? 'proxy-cache' : 'upstream',
    }
  },
}

export async function getTranslationServiceInfo(): Promise<{
  status: 'ready' | 'unconfigured' | 'unavailable'
  quota: TranslationQuota | null
}> {
  try {
    const response = await fetch('/api/translation/status', { cache: 'no-store' })
    if (!response.ok) return { status: 'unavailable', quota: null }
    const data = await response.json() as { configured?: unknown; usage?: TranslationQuota }
    return { status: data.configured === true ? 'ready' : 'unconfigured', quota: data.usage ?? null }
  } catch {
    return { status: 'unavailable', quota: null }
  }
}

/** Translates a user-selected text fragment without creating or persisting a paragraph record. */
export async function translateSelectionText(text: string, sourceLanguage: SourceLanguage): Promise<TranslationResult> {
  const normalizedText = text.replace(/\s+/gu, ' ').trim()
  if (!normalizedText || normalizedText.length > 3000) {
    throw new TranslationError('invalid-response', '所选内容为空或超过 3000 字符。')
  }
  const sourceTextHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedText))
    .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
  return aliyunTranslationProvider.translate({
    documentId: 'sha256:selection' as DocumentId,
    paragraphId: `selection:${sourceTextHash}`,
    sourceText: normalizedText,
    sourceTextHash,
    sourceLanguage,
    targetLanguage: 'zh-CN',
    preprocessingVersion: TRANSLATION_PREPROCESSING_VERSION,
  })
}

export function createTranslationRecord(paragraph: PdfParagraph, result: TranslationResult): TranslationRecord {
  if (result.paragraphId !== paragraph.id || result.sourceTextHash !== paragraph.sourceTextHash) {
    throw new TranslationError('invalid-response', '译文与当前原文段落不匹配。')
  }
  return {
    id: versionedTranslationRecordId(paragraph.id, result.targetLanguage, result.sourceLanguage, paragraph.sourceTextHash, result.preprocessingVersion),
    documentId: paragraph.documentId,
    paragraphId: paragraph.id,
    sourceTextHash: paragraph.sourceTextHash,
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    translatedText: result.translatedText,
    createdAt: result.createdAt,
    preprocessingVersion: result.preprocessingVersion,
    translationSource: result.translationSource,
  }
}

export function translationRecordKey(paragraphId: string, sourceLanguage: SourceLanguage, targetLanguage: TargetLanguage = 'zh-CN') {
  return `${paragraphId}:${sourceLanguage}:${targetLanguage}`
}

export function canApplyTranslationResult(
  paragraphDocumentId: DocumentId,
  activeDocumentId: DocumentId | null,
  requestGeneration: number,
  activeGeneration: number,
) {
  return paragraphDocumentId === activeDocumentId && requestGeneration === activeGeneration
}

export function mergeTranslationRecord(
  current: Record<string, TranslationRecord>,
  key: string,
  translation: TranslationRecord,
) {
  return { ...current, [key]: translation }
}

export function createTranslationRequest(
  paragraph: PdfParagraph,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage = 'zh-CN',
): TranslationRequest {
  return {
    documentId: paragraph.documentId,
    paragraphId: paragraph.id,
    sourceText: prepareTranslationText(paragraph),
    sourceTextHash: paragraph.sourceTextHash,
    sourceLanguage,
    targetLanguage,
    preprocessingVersion: TRANSLATION_PREPROCESSING_VERSION,
  }
}
