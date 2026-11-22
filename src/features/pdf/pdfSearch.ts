import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractPdfPageText } from './pdfService'
import type { DocumentId, PdfPageBounds, PdfPageText } from './pdfTypes'
import { hasUsablePageBounds } from './paragraphLocation'

export type PdfTextSearchResult = {
  /** Kept only for the lifetime of this in-memory search; prevents stale-document navigation. */
  document: PDFDocumentProxy
  documentId: DocumentId
  paragraphId: string
  sourceTextHash: string
  pageNumber: number
  paragraphIndex: number
  pageBounds: PdfPageBounds | null
  matchCount: number
  context: { before: string; match: string; after: string }
}

export type PdfTextSearchProgress = {
  scannedPages: number
  totalPages: number
  matchCount: number
  matchingParagraphCount: number
  addedResults: PdfTextSearchResult[]
}

export type PdfTextSearchSummary = Omit<PdfTextSearchProgress, 'addedResults'> & { cancelled: boolean }

export type PdfTextSearchOptions = {
  signal?: AbortSignal
  onProgress?: (progress: PdfTextSearchProgress) => void
  /** Injectable page extractor for isolated tests. Production uses the normal PDF.js pipeline. */
  extractPage?: (document: PDFDocumentProxy, pageNumber: number, documentId: DocumentId) => Promise<PdfPageText>
}

export class PdfTextSearchPageError extends Error {
  constructor(public readonly pageNumber: number, options?: ErrorOptions) {
    super('A PDF page could not be searched.', options)
    this.name = 'PdfTextSearchPageError'
  }
}

export function normalizePdfSearchText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function findParagraphMatches(text: string, query: string): {
  matchCount: number
  context: PdfTextSearchResult['context'] | null
} {
  const normalizedText = normalizePdfSearchText(text)
  const normalizedQuery = normalizePdfSearchText(query)
  if (!normalizedText || !normalizedQuery) return { matchCount: 0, context: null }

  // Escape user input so this remains a literal, case-insensitive search rather than regex search.
  const matcher = new RegExp(escapeRegExp(normalizedQuery), 'giu')
  let matchCount = 0
  let firstIndex = -1
  let firstMatch = ''
  for (const match of normalizedText.matchAll(matcher)) {
    if (firstIndex < 0) {
      firstIndex = match.index ?? 0
      firstMatch = match[0]
    }
    matchCount += 1
  }
  if (firstIndex < 0) return { matchCount: 0, context: null }

  const contextWidth = 48
  const start = Math.max(0, firstIndex - contextWidth)
  const end = Math.min(normalizedText.length, firstIndex + firstMatch.length + contextWidth)
  return {
    matchCount,
    context: {
      before: `${start > 0 ? '…' : ''}${normalizedText.slice(start, firstIndex)}`,
      match: normalizedText.slice(firstIndex, firstIndex + firstMatch.length),
      after: `${normalizedText.slice(firstIndex + firstMatch.length, end)}${end < normalizedText.length ? '…' : ''}`,
    },
  }
}

export async function searchPdfText(
  document: PDFDocumentProxy,
  documentId: DocumentId,
  query: string,
  options: PdfTextSearchOptions = {},
): Promise<PdfTextSearchSummary> {
  const normalizedQuery = normalizePdfSearchText(query)
  const totalPages = document.numPages
  let scannedPages = 0
  let matchCount = 0
  let matchingParagraphCount = 0
  const extractPage = options.extractPage ?? extractPdfPageText
  const signal = options.signal

  const summary = (cancelled: boolean): PdfTextSearchSummary => ({
    scannedPages,
    totalPages,
    matchCount,
    matchingParagraphCount,
    cancelled,
  })
  if (!normalizedQuery || !Number.isSafeInteger(totalPages) || totalPages < 1) return summary(false)

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    if (signal?.aborted) return summary(true)
    // Intentionally serial: only one page's organized text is held by this loop at a time.
    let pageText: PdfPageText
    try {
      pageText = await extractPage(document, pageNumber, documentId)
    } catch (error) {
      if (signal?.aborted) return summary(true)
      throw new PdfTextSearchPageError(pageNumber, error instanceof Error ? { cause: error } : undefined)
    }
    // An in-flight PDF.js extraction may finish after cancellation; discard it and do not continue.
    if (signal?.aborted) return summary(true)

    const addedResults: PdfTextSearchResult[] = []
    if (pageText.source !== 'ocr') {
      for (const paragraph of pageText.paragraphs) {
        if (paragraph.documentId !== documentId
          || paragraph.pageNumber !== pageNumber
          || !paragraph.id.startsWith(`${documentId}:page:${pageNumber}:paragraph:`)
          || !paragraph.sourceTextHash.trim()
          || !Number.isSafeInteger(paragraph.paragraphIndex) || paragraph.paragraphIndex < 1) continue
        const found = findParagraphMatches(paragraph.text, normalizedQuery)
        if (!found.matchCount || !found.context) continue
        addedResults.push({
          document,
          documentId: paragraph.documentId,
          paragraphId: paragraph.id,
          sourceTextHash: paragraph.sourceTextHash,
          pageNumber: paragraph.pageNumber,
          paragraphIndex: paragraph.paragraphIndex,
          pageBounds: hasUsablePageBounds(paragraph.pageBounds) ? { ...paragraph.pageBounds } : null,
          matchCount: found.matchCount,
          context: found.context,
        })
      }
    }
    scannedPages = pageNumber
    matchCount += addedResults.reduce((total, result) => total + result.matchCount, 0)
    matchingParagraphCount += addedResults.length
    options.onProgress?.({ scannedPages, totalPages, matchCount, matchingParagraphCount, addedResults })
  }

  return summary(false)
}

export function canLocateSearchResult(
  result: PdfTextSearchResult,
  activeDocument: PDFDocumentProxy | null,
  activeDocumentId: DocumentId | null,
): boolean {
  return Boolean(activeDocument
    && result.document === activeDocument
    && result.documentId === activeDocumentId
    && result.paragraphId.startsWith(`${result.documentId}:page:${result.pageNumber}:paragraph:`)
    && result.sourceTextHash.trim()
    && hasUsablePageBounds(result.pageBounds))
}

export function isPdfTextSearchRunCurrent(
  requestId: number,
  activeRequestId: number,
  requestedDocument: PDFDocumentProxy,
  requestedDocumentId: DocumentId,
  activeDocument: PDFDocumentProxy,
  activeDocumentId: DocumentId,
  signal: AbortSignal,
): boolean {
  return requestId === activeRequestId
    && requestedDocument === activeDocument
    && requestedDocumentId === activeDocumentId
    && !signal.aborted
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
