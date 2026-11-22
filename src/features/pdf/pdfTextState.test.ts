import { describe, expect, it } from 'vitest'
import type { PdfPageText } from './pdfTypes'
import { initialPdfTextState, reducePdfTextState, shouldExtractPdfPageText } from './pdfTextState'
import { getPdfPageTextDisplayState } from './PdfPageTextContent'

const oldDocumentPage = { pageNumber: 1, items: [], paragraphs: [], extractedAt: 1 } as PdfPageText
const newDocumentPage = { pageNumber: 1, items: [], paragraphs: [], extractedAt: 2 } as PdfPageText

describe('PDF text state document generations', () => {
  it('ignores an old document extraction that completes after a document switch', () => {
    let state = reducePdfTextState(initialPdfTextState, { type: 'reset-document', documentGeneration: 1 })
    state = reducePdfTextState(state, { type: 'page-loading', documentGeneration: 1, pageNumber: 1 })
    state = reducePdfTextState(state, { type: 'reset-document', documentGeneration: 2 })

    const newDocumentState = state
    state = reducePdfTextState(state, {
      type: 'page-loaded',
      documentGeneration: 1,
      pageNumber: 1,
      pageText: oldDocumentPage,
    })
    expect(state).toBe(newDocumentState)
    expect(state.pageTexts[1]).toBeUndefined()

    state = reducePdfTextState(state, {
      type: 'page-loaded',
      documentGeneration: 2,
      pageNumber: 1,
      pageText: newDocumentPage,
    })
    expect(state.pageTexts[1]).toBe(newDocumentPage)
  })

  it('ignores stale extraction failures and does not clear the new document loading state', () => {
    let state = reducePdfTextState(initialPdfTextState, { type: 'reset-document', documentGeneration: 1 })
    state = reducePdfTextState(state, { type: 'reset-document', documentGeneration: 2 })
    state = reducePdfTextState(state, { type: 'page-loading', documentGeneration: 2, pageNumber: 1 })
    const stateWhileLoading = state
    state = reducePdfTextState(state, { type: 'page-failed', documentGeneration: 1, pageNumber: 1 })
    expect(state).toBe(stateWhileLoading)
    expect(state.loadingPages.has(1)).toBe(true)
    expect(state.failedPages.has(1)).toBe(false)
  })

  it('surfaces an extraction failure as an error state rather than a no-text state', () => {
    let state = reducePdfTextState(initialPdfTextState, { type: 'reset-document', documentGeneration: 1 })
    state = reducePdfTextState(state, { type: 'page-loading', documentGeneration: 1, pageNumber: 1 })
    state = reducePdfTextState(state, { type: 'page-failed', documentGeneration: 1, pageNumber: 1 })
    expect(state.failedPages.has(1)).toBe(true)
    expect(state.pageTexts[1]).toBeUndefined()
    expect(getPdfPageTextDisplayState({
      isLoading: state.loadingPages.has(1),
      hasError: state.failedPages.has(1),
      pageText: state.pageTexts[1] ?? null,
    })).toBe('error')
  })

  it('does not automatically restart a failed page extraction on every state update', () => {
    let state = reducePdfTextState(initialPdfTextState, { type: 'reset-document', documentGeneration: 1 })
    expect(shouldExtractPdfPageText(state, 1)).toBe(true)
    state = reducePdfTextState(state, { type: 'page-loading', documentGeneration: 1, pageNumber: 1 })
    expect(shouldExtractPdfPageText(state, 1)).toBe(false)
    state = reducePdfTextState(state, { type: 'page-failed', documentGeneration: 1, pageNumber: 1 })
    expect(shouldExtractPdfPageText(state, 1)).toBe(false)
  })

  it('does not allow an OCR result from an old document generation to replace the current page', () => {
    let state = reducePdfTextState(initialPdfTextState, { type: 'reset-document', documentGeneration: 4 })
    state = reducePdfTextState(state, { type: 'reset-document', documentGeneration: 5 })
    const currentState = state
    state = reducePdfTextState(state, {
      type: 'ocr-loaded', documentGeneration: 4, pageNumber: 1, pageText: oldDocumentPage,
    })
    expect(state).toBe(currentState)
    expect(state.ocrPageTexts[1]).toBeUndefined()
  })

  it('keeps OCR failure separate from an OCR-completed blank page', () => {
    let state = reducePdfTextState(initialPdfTextState, { type: 'reset-document', documentGeneration: 1 })
    state = reducePdfTextState(state, { type: 'ocr-loading', documentGeneration: 1, pageNumber: 1 })
    state = reducePdfTextState(state, { type: 'ocr-failed', documentGeneration: 1, pageNumber: 1 })
    expect(state.ocrFailedPages.has(1)).toBe(true)
    expect(state.ocrCompletedPages.has(1)).toBe(false)
    state = reducePdfTextState(state, { type: 'ocr-loading', documentGeneration: 1, pageNumber: 2 })
    state = reducePdfTextState(state, { type: 'ocr-loaded', documentGeneration: 1, pageNumber: 2, pageText: newDocumentPage })
    expect(state.ocrCompletedPages.has(2)).toBe(true)
    expect(state.ocrFailedPages.has(2)).toBe(false)
  })
})
