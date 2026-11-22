import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'

export type DocumentId = `sha256:${string}`
export type SourceLanguage = 'en' | 'ja' | 'fr' | 'de'
export type TargetLanguage = 'zh-CN'

export const SOURCE_LANGUAGES: ReadonlyArray<{ code: SourceLanguage; label: string }> = [
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
]

/** The user supplied file stays intact; PDF.js only receives a byte view. */
export type ImportedPdf = {
  id: DocumentId
  file: File
  document: PDFDocumentProxy
  loadingTask: PDFDocumentLoadingTask
  pageCount: number
}

export type PdfTextItem = {
  text: string
  x: number
  y: number
  width: number
  height: number
  hasLineBreakAfter: boolean
  /** Paragraph-local line assigned by organizePageText; absent for OCR/manual legacy items. */
  lineIndex?: number
}

export type PdfPageBounds = {
  /** Coordinates are in PDF user space, whose origin is at the page's bottom-left. */
  coordinateSystem: 'pdf-user-space'
  x: number
  y: number
  width: number
  height: number
}

export type PdfParagraph = {
  /** Stable for the same PDF bytes, page, and extracted paragraph order. */
  id: string
  documentId: DocumentId
  pageNumber: number
  paragraphIndex: number
  /** Immutable extracted original text; translations are stored separately. */
  readonly text: string
  /** SHA-256 checksum of text, stored separately from the paragraph identity. */
  sourceTextHash: string
  pageBounds: PdfPageBounds | null
  items: readonly PdfTextItem[]
}

export type PdfPageText = {
  pageNumber: number
  items: PdfTextItem[]
  paragraphs: PdfParagraph[]
  extractedAt: number
  /** Indicates whether text came from the PDF text layer or local OCR. */
  source?: 'pdf-text' | 'ocr'
}

export type PdfLoadErrorCode = 'empty' | 'not-pdf' | 'password' | 'invalid' | 'read-failed'

export type TranslationRecord = {
  id: string
  documentId: DocumentId
  paragraphId: string
  sourceTextHash?: string
  sourceLanguage: SourceLanguage
  targetLanguage: TargetLanguage
  translatedText: string
  /** Version of translation-only preprocessing; absent on legacy records. */
  preprocessingVersion?: number
  /** Distinguishes the proxy cache from a new upstream call when known. */
  translationSource?: 'proxy-cache' | 'upstream'
  createdAt: number
}

/** A user-authored annotation associated with a stable paragraph identity. */
export type NoteRecord = {
  id: string
  documentId: DocumentId
  paragraphId: string
  sourceTextHash?: string
  pageNumber: number
  text: string
  updatedAt: number
}

/** Reserved for a later glossary stage. */
export type GlossaryEntry = {
  id: string
  documentId: DocumentId | null
  sourceLanguage: SourceLanguage
  sourceTerm: string
  targetLanguage: TargetLanguage
  targetTerm: string
}

export class PdfLoadError extends Error {
  constructor(
    public readonly code: PdfLoadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PdfLoadError'
  }
}
