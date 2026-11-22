import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'
import { extractPdfPageText, openPdfFile } from './pdfService'
import { recognizePdfPage, shouldRunOcr } from './ocrService'
import type { PdfPageText } from './pdfTypes'
import type { DocumentId } from './pdfTypes'
import { initialPdfTextState, reducePdfTextState, shouldExtractPdfPageText } from './pdfTextState'
import { parseReadingProgressRecord, type ReadingProgressRecord } from './readingProgressStore'
import { getInitialReadingPageNumber } from './readingProgress'
import { isCurrentPdfImport } from './pdfImportLifecycle'

export type InitialProgressReadResult = { record: ReadingProgressRecord | null; failed: boolean }
export type ReadInitialProgress = (
  documentId: DocumentId,
  pageCount: number,
  document: PDFDocumentProxy,
) => Promise<InitialProgressReadResult>
export type PdfImportResult = {
  documentId: DocumentId
  document: PDFDocumentProxy
  pageCount: number
  progress: ReadingProgressRecord | null
  progressReadFailed: boolean
}

export function usePdfReader() {
  const [file, setFile] = useState<File | null>(null)
  const [documentId, setDocumentId] = useState<DocumentId | null>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [isOpening, setIsOpening] = useState(false)
  const [textState, dispatchTextState] = useReducer(reducePdfTextState, initialPdfTextState)
  const [ocrRetryToken, setOcrRetryToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const operationId = useRef(0)
  const documentGeneration = useRef(0)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const pendingExtractions = useRef(new Map<string, Promise<PdfPageText>>())
  const pendingOcr = useRef(new Set<string>())

  const importFile = useCallback(async (nextFile: File, readInitialProgress?: ReadInitialProgress): Promise<PdfImportResult | null> => {
    const currentOperation = ++operationId.current
    setError(null)
    setIsOpening(true)
    try {
      const nextPdf = await openPdfFile(nextFile)
      if (!isCurrentPdfImport(currentOperation, operationId.current)) {
        void nextPdf.loadingTask.destroy()
        return null
      }
      let progressResult: InitialProgressReadResult = { record: null, failed: false }
      if (readInitialProgress) {
        try {
          progressResult = await readInitialProgress(nextPdf.documentId, nextPdf.document.numPages, nextPdf.document)
        } catch {
          progressResult = { record: null, failed: true }
        }
      }
      if (!isCurrentPdfImport(currentOperation, operationId.current)) {
        void nextPdf.loadingTask.destroy()
        return null
      }
      const progress = progressResult.record
        ? parseReadingProgressRecord(progressResult.record, nextPdf.documentId, nextPdf.document.numPages)
        : null
      const previousLoadingTask = loadingTaskRef.current
      documentRef.current = nextPdf.document
      loadingTaskRef.current = nextPdf.loadingTask
      setDocument(nextPdf.document)
      setFile(nextFile)
      setDocumentId(nextPdf.documentId)
      setPageCount(nextPdf.document.numPages)
      setPageNumber(getInitialReadingPageNumber(progress, nextPdf.document.numPages))
      const nextGeneration = ++documentGeneration.current
      dispatchTextState({ type: 'reset-document', documentGeneration: nextGeneration })
      pendingExtractions.current.clear()
      pendingOcr.current.clear()
      setIsOpening(false)
      setError(null)
      if (previousLoadingTask && previousLoadingTask !== nextPdf.loadingTask) void previousLoadingTask.destroy()
      return {
        documentId: nextPdf.documentId,
        document: nextPdf.document,
        pageCount: nextPdf.document.numPages,
        progress,
        progressReadFailed: progressResult.failed,
      }
    } catch (importError) {
      if (!isCurrentPdfImport(currentOperation, operationId.current)) return null
      console.error('[Marginalia PDF document load] Failed to open file.', { fileName: nextFile.name, error: importError })
      setIsOpening(false)
      setError(importError instanceof Error ? importError.message : 'PDF 导入失败，请重试。')
      return null
    }
  }, [])

  const goToPage = useCallback((nextPageNumber: number) => {
    if (!Number.isSafeInteger(nextPageNumber) || nextPageNumber < 1 || nextPageNumber > pageCount) return false
    setPageNumber(nextPageNumber)
    return true
  }, [pageCount])

  useEffect(() => {
    if (!document || !documentId || !shouldExtractPdfPageText(textState, pageNumber)) return
    const requestedGeneration = textState.documentGeneration
    const requestKey = `${requestedGeneration}:${pageNumber}`
    if (pendingExtractions.current.has(requestKey)) return
    dispatchTextState({ type: 'page-loading', documentGeneration: requestedGeneration, pageNumber })
    const extraction = extractPdfPageText(document, pageNumber, documentId).then((pageText) => ({ ...pageText, source: 'pdf-text' as const }))
    pendingExtractions.current.set(requestKey, extraction)
    void extraction.then((pageText) => {
      dispatchTextState({ type: 'page-loaded', documentGeneration: requestedGeneration, pageNumber, pageText })
    }).catch((error) => {
      if (requestedGeneration === documentGeneration.current) {
        console.error('[Marginalia PDF text extraction] Failed to extract page text.', { documentId, pageNumber, error })
      }
      dispatchTextState({ type: 'page-failed', documentGeneration: requestedGeneration, pageNumber })
    }).finally(() => {
      pendingExtractions.current.delete(requestKey)
    })
  }, [document, documentId, pageNumber, textState])

  useEffect(() => {
    const extractedPage = textState.pageTexts[pageNumber]
    if (!document || !documentId || !extractedPage || !shouldRunOcr(extractedPage)
      || textState.ocrCompletedPages.has(pageNumber) || textState.ocrLoadingPages.has(pageNumber)
      || textState.ocrFailedPages.has(pageNumber)) return
    const requestedGeneration = textState.documentGeneration
    const requestKey = `${requestedGeneration}:${pageNumber}`
    if (pendingOcr.current.has(requestKey)) return
    pendingOcr.current.add(requestKey)
    dispatchTextState({ type: 'ocr-loading', documentGeneration: requestedGeneration, pageNumber })
    void recognizePdfPage(document, pageNumber, documentId).then((pageText) => {
      dispatchTextState({ type: 'ocr-loaded', documentGeneration: requestedGeneration, pageNumber, pageText })
    }).catch((error) => {
      if (requestedGeneration === documentGeneration.current) {
        console.error('[Marginalia PDF OCR] Failed to recognize page.', { documentId, pageNumber, error })
      }
      dispatchTextState({ type: 'ocr-failed', documentGeneration: requestedGeneration, pageNumber })
    }).finally(() => {
      pendingOcr.current.delete(requestKey)
    })
  }, [document, documentId, pageNumber, ocrRetryToken, textState])

  useEffect(() => () => {
    operationId.current += 1
    documentGeneration.current += 1
    if (loadingTaskRef.current) void loadingTaskRef.current.destroy()
  }, [])

  return {
    file,
    documentId,
    document,
    pageCount,
    pageNumber,
    isOpening,
    pageText: textState.ocrPageTexts[pageNumber] ?? textState.pageTexts[pageNumber] ?? null,
    isExtractingText: textState.loadingPages.has(pageNumber),
    textExtractionFailed: textState.failedPages.has(pageNumber),
    isOcrProcessing: textState.ocrLoadingPages.has(pageNumber),
    ocrFailed: textState.ocrFailedPages.has(pageNumber),
    ocrCompleted: textState.ocrCompletedPages.has(pageNumber),
    retryOcr: () => {
      if (!documentId) return
      dispatchTextState({ type: 'ocr-retry', documentGeneration: textState.documentGeneration, pageNumber })
      setOcrRetryToken((current) => current + 1)
    },
    error,
    importFile,
    goToPage,
  }
}
