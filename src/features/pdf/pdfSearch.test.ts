import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentId, PdfPageText } from './pdfTypes'
import { canLocateSearchResult, findParagraphMatches, isPdfTextSearchRunCurrent, normalizePdfSearchText, searchPdfText } from './pdfSearch'

const documentId = 'sha256:search-doc' as DocumentId
const documentProxy = { numPages: 3 } as PDFDocumentProxy

function pageText(pageNumber: number, paragraphs: PdfPageText['paragraphs'], source: PdfPageText['source'] = 'pdf-text'): PdfPageText {
  return { pageNumber, paragraphs, items: [], extractedAt: 1, source }
}

function paragraph(pageNumber: number, paragraphIndex: number, text: string) {
  return {
    id: `${documentId}:page:${pageNumber}:paragraph:${paragraphIndex}`,
    documentId,
    pageNumber,
    paragraphIndex,
    text,
    sourceTextHash: `hash-${pageNumber}-${paragraphIndex}`,
    pageBounds: { coordinateSystem: 'pdf-user-space' as const, x: 10, y: 20, width: 80, height: 12 },
    items: [],
  }
}

describe('PDF full-text search', () => {
  it('matches case-insensitively and counts occurrences separately from paragraphs', async () => {
    const extractPage = vi.fn(async (_document, pageNumber) => pageNumber === 1
      ? pageText(1, [paragraph(1, 1, 'Margin marginalia MARGINALIA'), paragraph(1, 2, 'No hit')])
      : pageText(pageNumber, pageNumber === 3 ? [paragraph(3, 1, 'marginalia') ] : []))
    const progress: number[] = []
    const summary = await searchPdfText(documentProxy, documentId, 'Marginalia', {
      extractPage,
      onProgress: (update) => progress.push(update.scannedPages),
    })
    expect(summary).toMatchObject({ scannedPages: 3, totalPages: 3, matchCount: 3, matchingParagraphCount: 2, cancelled: false })
    expect(progress).toEqual([1, 2, 3])
    expect(extractPage.mock.calls.map(([_, page]) => page)).toEqual([1, 2, 3])
  })

  it('folds ordinary visual line breaks in the search copy without changing source text', () => {
    const sourceText = 'The first visual line\ncontinues here.'
    expect(normalizePdfSearchText(sourceText)).toBe('The first visual line continues here.')
    expect(findParagraphMatches(sourceText, 'line continues')).toMatchObject({ matchCount: 1 })
    expect(sourceText).toBe('The first visual line\ncontinues here.')
  })

  it('returns a concise context with the matched spelling highlighted separately', () => {
    expect(findParagraphMatches('Before the MARGINALIA phrase appears after.', 'marginalia')).toEqual({
      matchCount: 1,
      context: { before: 'Before the ', match: 'MARGINALIA', after: ' phrase appears after.' },
    })
  })

  it('treats punctuation literally instead of interpreting the query as regular expression syntax', () => {
    expect(findParagraphMatches('C++ is literal; Cxx is different.', 'C++')).toMatchObject({ matchCount: 1 })
  })

  it('reports cumulative progress and excludes text explicitly marked as OCR', async () => {
    const extractPage = vi.fn(async (_document, pageNumber) => pageNumber === 2
      ? pageText(2, [paragraph(2, 1, 'OCR-only marginalia')], 'ocr')
      : pageText(pageNumber, pageNumber === 1 ? [paragraph(1, 1, 'PDF text marginalia')] : []))
    const updates: Array<[number, number, number]> = []
    const summary = await searchPdfText(documentProxy, documentId, 'marginalia', {
      extractPage,
      onProgress: ({ scannedPages, matchCount, matchingParagraphCount }) => updates.push([scannedPages, matchCount, matchingParagraphCount]),
    })
    expect(summary).toMatchObject({ scannedPages: 3, matchCount: 1, matchingParagraphCount: 1 })
    expect(updates).toEqual([[1, 1, 1], [2, 1, 1], [3, 1, 1]])
  })

  it('surfaces the failed page without discarding earlier partial results', async () => {
    const extractPage = vi.fn(async (_document, pageNumber) => {
      if (pageNumber === 2) throw new Error('private internals not exposed')
      return pageText(1, [paragraph(1, 1, 'needle')])
    })
    const onProgress = vi.fn()
    await expect(searchPdfText(documentProxy, documentId, 'needle', { extractPage, onProgress }))
      .rejects.toMatchObject({
        name: 'PdfTextSearchPageError',
        pageNumber: 2,
        message: 'A PDF page could not be searched.',
      })
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ scannedPages: 1, matchCount: 1 }))
  })

  it('allows the in-flight page extraction to finish after cancellation but scans no later pages', async () => {
    const controller = new AbortController()
    let finishFirstPage!: (value: PdfPageText) => void
    const extractPage = vi.fn((_document, pageNumber: number) => pageNumber === 1
      ? new Promise<PdfPageText>((resolve) => { finishFirstPage = resolve })
      : Promise.resolve(pageText(pageNumber, [])))
    const onProgress = vi.fn()
    const pending = searchPdfText(documentProxy, documentId, 'needle', { signal: controller.signal, extractPage, onProgress })
    controller.abort()
    finishFirstPage(pageText(1, [paragraph(1, 1, 'needle')]))
    await expect(pending).resolves.toMatchObject({ scannedPages: 0, matchCount: 0, cancelled: true })
    expect(extractPage).toHaveBeenCalledTimes(1)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('rejects navigation for stale documents, malformed paragraph identity, hashes, or coordinates', () => {
    const result = {
      document: documentProxy,
      documentId,
      paragraphId: `${documentId}:page:2:paragraph:1`,
      sourceTextHash: 'hash',
      pageNumber: 2,
      paragraphIndex: 1,
      pageBounds: { coordinateSystem: 'pdf-user-space' as const, x: 10, y: 20, width: 80, height: 12 },
      matchCount: 1,
      context: { before: '', match: 'needle', after: '' },
    }
    expect(canLocateSearchResult(result, documentProxy, documentId)).toBe(true)
    expect(canLocateSearchResult(result, {} as PDFDocumentProxy, documentId)).toBe(false)
    expect(canLocateSearchResult(result, documentProxy, 'sha256:other' as DocumentId)).toBe(false)
    expect(canLocateSearchResult({ ...result, paragraphId: 'old-paragraph' }, documentProxy, documentId)).toBe(false)
    expect(canLocateSearchResult({ ...result, sourceTextHash: '' }, documentProxy, documentId)).toBe(false)
    expect(canLocateSearchResult({ ...result, pageBounds: null }, documentProxy, documentId)).toBe(false)
  })

  it('invalidates a task when its query generation, PDF instance, document ID, or signal changes', () => {
    const controller = new AbortController()
    expect(isPdfTextSearchRunCurrent(4, 4, documentProxy, documentId, documentProxy, documentId, controller.signal)).toBe(true)
    expect(isPdfTextSearchRunCurrent(3, 4, documentProxy, documentId, documentProxy, documentId, controller.signal)).toBe(false)
    expect(isPdfTextSearchRunCurrent(4, 4, documentProxy, documentId, {} as PDFDocumentProxy, documentId, controller.signal)).toBe(false)
    expect(isPdfTextSearchRunCurrent(4, 4, documentProxy, documentId, documentProxy, 'sha256:other' as DocumentId, controller.signal)).toBe(false)
    controller.abort()
    expect(isPdfTextSearchRunCurrent(4, 4, documentProxy, documentId, documentProxy, documentId, controller.signal)).toBe(false)
  })

  it('does not turn stale or malformed extracted paragraph identities into search hits', async () => {
    const stale = { ...paragraph(1, 1, 'needle'), documentId: 'sha256:other' as DocumentId }
    const extractPage = vi.fn(async () => pageText(1, [stale]))
    const summary = await searchPdfText(documentProxy, documentId, 'needle', { extractPage })
    expect(summary.matchCount).toBe(0)
    expect(summary.matchingParagraphCount).toBe(0)
  })
})
