import type { PdfPageText } from './pdfTypes'

export type PdfTextState = {
  documentGeneration: number
  pageTexts: Record<number, PdfPageText>
  ocrPageTexts: Record<number, PdfPageText>
  ocrLoadingPages: Set<number>
  ocrFailedPages: Set<number>
  ocrCompletedPages: Set<number>
  loadingPages: Set<number>
  failedPages: Set<number>
}

export type PdfTextAction =
  | { type: 'reset-document'; documentGeneration: number }
  | { type: 'page-loading'; documentGeneration: number; pageNumber: number }
  | { type: 'page-loaded'; documentGeneration: number; pageNumber: number; pageText: PdfPageText }
  | { type: 'page-failed'; documentGeneration: number; pageNumber: number }
  | { type: 'ocr-loading'; documentGeneration: number; pageNumber: number }
  | { type: 'ocr-loaded'; documentGeneration: number; pageNumber: number; pageText: PdfPageText }
  | { type: 'ocr-failed'; documentGeneration: number; pageNumber: number }
  | { type: 'ocr-retry'; documentGeneration: number; pageNumber: number }

export const initialPdfTextState: PdfTextState = {
  documentGeneration: 0,
  pageTexts: {},
  ocrPageTexts: {},
  ocrLoadingPages: new Set(),
  ocrFailedPages: new Set(),
  ocrCompletedPages: new Set(),
  loadingPages: new Set(),
  failedPages: new Set(),
}

export function shouldExtractPdfPageText(state: PdfTextState, pageNumber: number) {
  return !state.pageTexts[pageNumber]
    && !state.loadingPages.has(pageNumber)
    && !state.failedPages.has(pageNumber)
}

/** Reducer ignores delayed extraction actions from a document that has been replaced. */
export function reducePdfTextState(state: PdfTextState, action: PdfTextAction): PdfTextState {
  if (action.type === 'reset-document') {
    return {
      documentGeneration: action.documentGeneration,
      pageTexts: {},
      ocrPageTexts: {},
      ocrLoadingPages: new Set(),
      ocrFailedPages: new Set(),
      ocrCompletedPages: new Set(),
      loadingPages: new Set(),
      failedPages: new Set(),
    }
  }
  if (action.documentGeneration !== state.documentGeneration) return state

  if (action.type === 'ocr-retry') {
    const ocrFailedPages = new Set(state.ocrFailedPages)
    ocrFailedPages.delete(action.pageNumber)
    const ocrCompletedPages = new Set(state.ocrCompletedPages)
    ocrCompletedPages.delete(action.pageNumber)
    const ocrPageTexts = { ...state.ocrPageTexts }
    delete ocrPageTexts[action.pageNumber]
    return { ...state, ocrFailedPages, ocrCompletedPages, ocrPageTexts }
  }

  if (action.type === 'ocr-loading') {
    const ocrLoadingPages = new Set(state.ocrLoadingPages).add(action.pageNumber)
    const ocrFailedPages = new Set(state.ocrFailedPages)
    ocrFailedPages.delete(action.pageNumber)
    const ocrCompletedPages = new Set(state.ocrCompletedPages)
    ocrCompletedPages.delete(action.pageNumber)
    return { ...state, ocrLoadingPages, ocrFailedPages, ocrCompletedPages }
  }

  if (action.type === 'ocr-loaded') {
    const ocrLoadingPages = new Set(state.ocrLoadingPages)
    ocrLoadingPages.delete(action.pageNumber)
    const ocrFailedPages = new Set(state.ocrFailedPages)
    ocrFailedPages.delete(action.pageNumber)
    return {
      ...state,
      ocrLoadingPages,
      ocrFailedPages,
      ocrCompletedPages: new Set(state.ocrCompletedPages).add(action.pageNumber),
      ocrPageTexts: { ...state.ocrPageTexts, [action.pageNumber]: action.pageText },
    }
  }

  if (action.type === 'ocr-failed') {
    const ocrLoadingPages = new Set(state.ocrLoadingPages)
    ocrLoadingPages.delete(action.pageNumber)
    return {
      ...state,
      ocrLoadingPages,
      ocrFailedPages: new Set(state.ocrFailedPages).add(action.pageNumber),
    }
  }

  if (action.type === 'page-loading') {
    const loadingPages = new Set(state.loadingPages).add(action.pageNumber)
    const failedPages = new Set(state.failedPages)
    failedPages.delete(action.pageNumber)
    return { ...state, loadingPages, failedPages }
  }

  const loadingPages = new Set(state.loadingPages)
  loadingPages.delete(action.pageNumber)
  if (action.type === 'page-loaded') {
    return {
      ...state,
      loadingPages,
      failedPages: new Set([...state.failedPages].filter((page) => page !== action.pageNumber)),
      pageTexts: { ...state.pageTexts, [action.pageNumber]: action.pageText },
    }
  }

  const failedPages = new Set(state.failedPages).add(action.pageNumber)
  return { ...state, loadingPages, failedPages }
}
