import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentId } from './pdfTypes'
import type { ReadingProgressRecord } from './readingProgressStore'

export type PagePositionMeasurement = {
  frameScrollLeft: number
  frameScrollTop: number
  frameClientWidth: number
  frameClientHeight: number
  canvasOffsetLeft: number
  canvasOffsetTop: number
  canvasWidth: number
  canvasHeight: number
}

export type ReadingProgressRestoreRequest = {
  requestId: number
  document: PDFDocumentProxy
  documentId: DocumentId
  pageNumber: number
  pageXRatio: number
  pageYRatio: number
}

export type ProgressPositionUpdate = {
  document: PDFDocumentProxy
  documentId: DocumentId
  pageNumber: number
  pageXRatio: number
  pageYRatio: number
  reason: 'scroll' | 'layout'
}

export function captureNormalizedPagePosition(measurement: PagePositionMeasurement) {
  const values = Object.values(measurement)
  if (!values.every(Number.isFinite)
    || measurement.frameClientWidth <= 0 || measurement.frameClientHeight <= 0
    || measurement.canvasWidth <= 0 || measurement.canvasHeight <= 0) return null
  return {
    pageXRatio: clamp((measurement.frameScrollLeft + measurement.frameClientWidth / 2 - measurement.canvasOffsetLeft) / measurement.canvasWidth),
    pageYRatio: clamp((measurement.frameScrollTop + measurement.frameClientHeight / 2 - measurement.canvasOffsetTop) / measurement.canvasHeight),
  }
}

export function calculateScrollOffsetForPageRatio(
  canvasOffset: number,
  canvasSize: number,
  pageRatio: number,
  frameSize: number,
  maxScroll: number,
): number | null {
  if (![canvasOffset, canvasSize, pageRatio, frameSize, maxScroll].every(Number.isFinite)
    || canvasSize <= 0 || pageRatio < 0 || pageRatio > 1 || frameSize <= 0 || maxScroll < 0) return null
  return Math.max(0, Math.min(maxScroll, canvasOffset + pageRatio * canvasSize - frameSize / 2))
}

export function isRestoreRequestCurrent(
  request: ReadingProgressRestoreRequest,
  document: PDFDocumentProxy,
  documentId: DocumentId | null,
  pageNumber: number,
): boolean {
  return request.document === document
    && request.documentId === documentId
    && request.pageNumber === pageNumber
    && Number.isFinite(request.pageXRatio) && request.pageXRatio >= 0 && request.pageXRatio <= 1
    && Number.isFinite(request.pageYRatio) && request.pageYRatio >= 0 && request.pageYRatio <= 1
}

export function getInitialReadingPageNumber(record: ReadingProgressRecord | null, pageCount: number): number {
  return record && Number.isSafeInteger(record.pageNumber) && record.pageNumber >= 1 && record.pageNumber <= pageCount
    ? record.pageNumber
    : 1
}

export function shouldSaveInitialReadingPosition(readSucceeded: boolean, hasStoredProgress: boolean): boolean {
  return readSucceeded && !hasStoredProgress
}

export class ReadingProgressRestoreController {
  private current: ReadingProgressRestoreRequest | null = null

  activate(request: ReadingProgressRestoreRequest | null) {
    this.current = request
    return request
  }

  cancel() {
    this.current = null
  }

  confirm(requestId: number): boolean {
    if (this.current?.requestId !== requestId) return false
    this.current = null
    return true
  }
}

export function nextProgressTimestamp(now: number, previous: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(previous)) return Number.NaN
  return Math.max(now, previous + 1)
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function createReadingProgressRecord(
  documentId: DocumentId,
  pageNumber: number,
  position: { pageXRatio: number; pageYRatio: number },
  updatedAt: number,
): ReadingProgressRecord | null {
  if (!documentId || !Number.isSafeInteger(pageNumber) || pageNumber < 1
    || !Number.isFinite(position.pageXRatio) || position.pageXRatio < 0 || position.pageXRatio > 1
    || !Number.isFinite(position.pageYRatio) || position.pageYRatio < 0 || position.pageYRatio > 1
    || !Number.isFinite(updatedAt) || updatedAt < 0) return null
  return {
    documentId,
    pageNumber,
    pageXRatio: position.pageXRatio,
    pageYRatio: position.pageYRatio,
    updatedAt,
    schemaVersion: 1,
  }
}
