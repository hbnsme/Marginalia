import type { PdfPageBounds, PdfParagraph, DocumentId } from './pdfTypes'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfViewportLike = {
  width: number
  height: number
  convertToViewportPoint: (x: number, y: number) => number[]
}

export type CssRectangle = { left: number; top: number; width: number; height: number }
export type ParagraphLocationRequest = {
  requestId: number
  document: PDFDocumentProxy
  documentId: DocumentId
  paragraphId: string
  sourceTextHash: string
  pageNumber: number
  pageBounds: PdfPageBounds
}

export type ParagraphLocationIdentity = Pick<PdfParagraph, 'id' | 'documentId' | 'pageNumber' | 'sourceTextHash' | 'pageBounds'>

export function hasUsablePageBounds(bounds: PdfPageBounds | null | undefined): bounds is PdfPageBounds {
  return Boolean(bounds
    && bounds.coordinateSystem === 'pdf-user-space'
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width) && bounds.width > 0
    && Number.isFinite(bounds.height) && bounds.height > 0
    && Number.isFinite(bounds.x + bounds.width)
    && Number.isFinite(bounds.y + bounds.height))
}

export function isParagraphLocatable(
  paragraph: PdfParagraph,
  activeDocumentId: DocumentId | null,
  pageNumber: number,
  pageSource: 'pdf-text' | 'ocr' | undefined,
): boolean {
  return pageSource === 'pdf-text'
    && Boolean(activeDocumentId)
    && paragraph.documentId === activeDocumentId
    && paragraph.pageNumber === pageNumber
    && paragraph.id.length > 0
    && paragraph.id.startsWith(`${paragraph.documentId}:page:${paragraph.pageNumber}:paragraph:`)
    && paragraph.sourceTextHash.trim().length > 0
    && hasUsablePageBounds(paragraph.pageBounds)
}

export function createParagraphLocationRequest(
  paragraph: PdfParagraph,
  document: PDFDocumentProxy | null,
  activeDocumentId: DocumentId | null,
  pageNumber: number,
  pageSource: 'pdf-text' | 'ocr' | undefined,
  requestId: number,
): ParagraphLocationRequest | null {
  if (!document || !isParagraphLocatable(paragraph, activeDocumentId, pageNumber, pageSource)
    || paragraph.pageNumber !== pageNumber) return null
  return createParagraphLocationRequestForIdentity(paragraph, document, activeDocumentId, requestId)
}

/** Create a request for a validated paragraph on any page of the current PDF, used by search hits. */
export function createParagraphLocationRequestForIdentity(
  paragraph: ParagraphLocationIdentity,
  document: PDFDocumentProxy | null,
  activeDocumentId: DocumentId | null,
  requestId: number,
): ParagraphLocationRequest | null {
  if (!document || !activeDocumentId
    || paragraph.documentId !== activeDocumentId
    || !Number.isSafeInteger(paragraph.pageNumber) || paragraph.pageNumber < 1 || paragraph.pageNumber > document.numPages
    || !paragraph.id.startsWith(`${paragraph.documentId}:page:${paragraph.pageNumber}:paragraph:`)
    || !paragraph.sourceTextHash.trim()
    || !hasUsablePageBounds(paragraph.pageBounds)
    || !Number.isSafeInteger(requestId) || requestId < 1) return null
  return {
    requestId,
    document,
    documentId: paragraph.documentId,
    paragraphId: paragraph.id,
    sourceTextHash: paragraph.sourceTextHash,
    pageNumber: paragraph.pageNumber,
    pageBounds: { ...paragraph.pageBounds },
  }
}

export function isParagraphLocationRequestCurrent(
  request: ParagraphLocationRequest,
  document: PDFDocumentProxy,
  activeDocumentId: DocumentId | null,
  pageNumber: number,
): boolean {
  return request.document === document
    && request.documentId === activeDocumentId
    && request.pageNumber === pageNumber
    && request.paragraphId.startsWith(`${request.documentId}:page:${request.pageNumber}:paragraph:`)
    && request.paragraphId.length > 0
    && request.sourceTextHash.trim().length > 0
    && hasUsablePageBounds(request.pageBounds)
}

/** Convert PDF user-space bounds to CSS pixels, independent of canvas backing-store DPR. */
export function getCssRectangleFromPdfBounds(
  bounds: PdfPageBounds,
  viewport: PdfViewportLike,
  cssWidth: number,
  cssHeight: number,
): CssRectangle | null {
  if (!hasUsablePageBounds(bounds)
    || !Number.isFinite(viewport.width) || viewport.width <= 0
    || !Number.isFinite(viewport.height) || viewport.height <= 0
    || !Number.isFinite(cssWidth) || cssWidth <= 0
    || !Number.isFinite(cssHeight) || cssHeight <= 0) return null

  let first: number[]
  let second: number[]
  try {
    first = viewport.convertToViewportPoint(bounds.x, bounds.y)
    second = viewport.convertToViewportPoint(bounds.x + bounds.width, bounds.y + bounds.height)
  } catch {
    return null
  }
  if (first.length < 2 || second.length < 2 || ![first[0], first[1], second[0], second[1]].every(Number.isFinite)) return null

  const horizontalScale = cssWidth / viewport.width
  const verticalScale = cssHeight / viewport.height
  const rawLeft = Math.min(first[0], second[0]) * horizontalScale
  const rawTop = Math.min(first[1], second[1]) * verticalScale
  const rawRight = Math.max(first[0], second[0]) * horizontalScale
  const rawBottom = Math.max(first[1], second[1]) * verticalScale
  if (![rawLeft, rawTop, rawRight, rawBottom].every(Number.isFinite)) return null
  const left = Math.max(0, rawLeft)
  const top = Math.max(0, rawTop)
  const right = Math.min(cssWidth, rawRight)
  const bottom = Math.min(cssHeight, rawBottom)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null
  return { left, top, width, height }
}

export function hasActiveParagraphTextSelection(selectionText: string | null | undefined): boolean {
  return Boolean(selectionText?.trim())
}

export function activateParagraphLocation(
  paragraph: PdfParagraph,
  selectionText: string | null | undefined,
  onLocate: (paragraph: PdfParagraph) => void,
): boolean {
  if (hasActiveParagraphTextSelection(selectionText)) return false
  onLocate(paragraph)
  return true
}
