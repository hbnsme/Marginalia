import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentId } from './pdfTypes'
import {
  calculateScrollOffsetForPageRatio,
  captureNormalizedPagePosition,
  getInitialReadingPageNumber,
  isRestoreRequestCurrent,
  nextProgressTimestamp,
  ReadingProgressRestoreController,
  shouldSaveInitialReadingPosition,
} from './readingProgress'
import { parseReadingProgressRecord } from './readingProgressStore'

const documentId = 'sha256:document-a' as DocumentId
const record = {
  documentId,
  pageNumber: 12,
  pageXRatio: 0.3,
  pageYRatio: 0.72,
  updatedAt: 123,
  schemaVersion: 1 as const,
}

describe('reading progress geometry and validation', () => {
  it('captures normalized page position without depending on scroll pixel scale', () => {
    const position = captureNormalizedPagePosition({
      frameScrollLeft: 100,
      frameScrollTop: 300,
      frameClientWidth: 400,
      frameClientHeight: 500,
      canvasOffsetLeft: 0,
      canvasOffsetTop: 100,
      canvasWidth: 1000,
      canvasHeight: 2000,
    })
    expect(position).toEqual({ pageXRatio: 0.3, pageYRatio: 0.225 })
    expect(captureNormalizedPagePosition({
      frameScrollLeft: 50,
      frameScrollTop: 150,
      frameClientWidth: 200,
      frameClientHeight: 250,
      canvasOffsetLeft: 0,
      canvasOffsetTop: 50,
      canvasWidth: 500,
      canvasHeight: 1000,
    })).toEqual(position)
  })

  it('restores equivalent page-relative positions at different viewport and page sizes', () => {
    expect(calculateScrollOffsetForPageRatio(10, 2000, 0.7, 500, 1510)).toBe(1160)
    expect(calculateScrollOffsetForPageRatio(10, 1000, 0.7, 250, 760)).toBe(585)
    expect(calculateScrollOffsetForPageRatio(10, 100, 0.7, 500, 0)).toBe(0)
  })

  it('rejects invalid geometry rather than producing NaN scroll offsets', () => {
    expect(captureNormalizedPagePosition({
      frameScrollLeft: 0, frameScrollTop: Number.NaN, frameClientWidth: 200, frameClientHeight: 200,
      canvasOffsetLeft: 0, canvasOffsetTop: 0, canvasWidth: 500, canvasHeight: 500,
    })).toBeNull()
    expect(calculateScrollOffsetForPageRatio(0, 100, 2, 50, 100)).toBeNull()
  })

  it('accepts only valid saved pages and normalized ratios', () => {
    expect(parseReadingProgressRecord(record, documentId, 20)).toEqual(record)
    expect(parseReadingProgressRecord(record, documentId, 10)).toBeNull()
    expect(parseReadingProgressRecord({ ...record, pageNumber: 0 }, documentId, 20)).toBeNull()
    expect(parseReadingProgressRecord({ ...record, pageXRatio: 1.1 }, documentId, 20)).toBeNull()
    expect(parseReadingProgressRecord({ ...record, pageYRatio: Number.NaN }, documentId, 20)).toBeNull()
    expect(parseReadingProgressRecord({ ...record, schemaVersion: 99 }, documentId, 20)).toBeNull()
    expect(parseReadingProgressRecord(record, 'sha256:other' as DocumentId, 20)).toBeNull()
  })

  it('chooses the stored page before page-dependent text extraction or OCR can start', () => {
    expect(getInitialReadingPageNumber(record, 20)).toBe(12)
    expect(getInitialReadingPageNumber(record, 10)).toBe(1)
    expect(getInitialReadingPageNumber(null, 20)).toBe(1)
  })

  it('never saves a temporary first-page layout over a stored position or failed read', () => {
    expect(shouldSaveInitialReadingPosition(true, true)).toBe(false)
    expect(shouldSaveInitialReadingPosition(false, false)).toBe(false)
    expect(shouldSaveInitialReadingPosition(true, false)).toBe(true)
  })

  it('rejects a restore request after document instance, document ID, or page changes', () => {
    const activeDocument = {} as PDFDocumentProxy
    const request = { requestId: 1, document: activeDocument, documentId, pageNumber: 12, pageXRatio: 0.3, pageYRatio: 0.7 }
    expect(isRestoreRequestCurrent(request, activeDocument, documentId, 12)).toBe(true)
    expect(isRestoreRequestCurrent(request, {} as PDFDocumentProxy, documentId, 12)).toBe(false)
    expect(isRestoreRequestCurrent(request, activeDocument, 'sha256:other' as DocumentId, 12)).toBe(false)
    expect(isRestoreRequestCurrent(request, activeDocument, documentId, 13)).toBe(false)
  })

  it('uses a monotonic write timestamp when events happen in the same millisecond', () => {
    expect(nextProgressTimestamp(1000, 999)).toBe(1000)
    expect(nextProgressTimestamp(1000, 1000)).toBe(1001)
    expect(nextProgressTimestamp(900, 1000)).toBe(1001)
  })

  it('cancels a pending automatic restore when the user acts and rejects stale confirmations', () => {
    const controller = new ReadingProgressRestoreController()
    const activeDocument = {} as PDFDocumentProxy
    const request = { requestId: 8, document: activeDocument, documentId, pageNumber: 12, pageXRatio: 0.3, pageYRatio: 0.7 }
    controller.activate(request)
    expect(controller.confirm(7)).toBe(false)
    controller.cancel()
    expect(controller.confirm(8)).toBe(false)
  })
})
