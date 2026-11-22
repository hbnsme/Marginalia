import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfParagraph } from './pdfTypes'
import {
  createParagraphLocationRequest,
  createParagraphLocationRequestForIdentity,
  activateParagraphLocation,
  getCssRectangleFromPdfBounds,
  hasActiveParagraphTextSelection,
  isParagraphLocatable,
  isParagraphLocationRequestCurrent,
} from './paragraphLocation'

const documentId = 'sha256:document-a' as const
const pageBounds = { coordinateSystem: 'pdf-user-space' as const, x: 20, y: 30, width: 60, height: 12 }
const paragraph: PdfParagraph = {
  id: `${documentId}:page:4:paragraph:2`,
  documentId,
  pageNumber: 4,
  paragraphIndex: 2,
  text: 'A located source paragraph.',
  sourceTextHash: 'source-hash-a',
  pageBounds,
  items: [],
}
const documentProxy = {} as PDFDocumentProxy

describe('PDF paragraph location helpers', () => {
  it('allows a text-layer paragraph only when page and full document identity are current', () => {
    expect(isParagraphLocatable(paragraph, documentId, 4, 'pdf-text')).toBe(true)
    expect(isParagraphLocatable(paragraph, documentId, 5, 'pdf-text')).toBe(false)
    expect(isParagraphLocatable(paragraph, 'sha256:other' as typeof documentId, 4, 'pdf-text')).toBe(false)
    expect(isParagraphLocatable(paragraph, documentId, 4, 'ocr')).toBe(false)
    expect(isParagraphLocatable({ ...paragraph, sourceTextHash: '' }, documentId, 4, 'pdf-text')).toBe(false)
  })

  it('skips missing, zero-sized and non-finite coordinate bounds', () => {
    expect(isParagraphLocatable({ ...paragraph, pageBounds: null }, documentId, 4, 'pdf-text')).toBe(false)
    expect(isParagraphLocatable({ ...paragraph, pageBounds: { ...pageBounds, width: 0 } }, documentId, 4, 'pdf-text')).toBe(false)
    expect(isParagraphLocatable({ ...paragraph, pageBounds: { ...pageBounds, y: Number.NaN } }, documentId, 4, 'pdf-text')).toBe(false)
  })

  it('converts through the PDF viewport and scales to CSS pixels rather than backing-store pixels', () => {
    const viewport = {
      width: 200,
      height: 400,
      convertToViewportPoint: (x: number, y: number) => [x * 2, y * 2],
    }
    expect(getCssRectangleFromPdfBounds(pageBounds, viewport, 200, 400)).toEqual({
      left: 40,
      top: 60,
      width: 120,
      height: 24,
    })
    // The canvas may have a 2x backing store; it is intentionally not an input here.
    expect(getCssRectangleFromPdfBounds(pageBounds, viewport, 100, 200)).toEqual({
      left: 20,
      top: 30,
      width: 60,
      height: 12,
    })
  })

  it('uses viewport conversion for rotated pages too', () => {
    const viewport = {
      width: 400,
      height: 200,
      convertToViewportPoint: (x: number, y: number) => [200 - y, x],
    }
    expect(getCssRectangleFromPdfBounds(pageBounds, viewport, 400, 200)).toEqual({
      left: 158,
      top: 20,
      width: 12,
      height: 60,
    })
  })

  it('rejects invalid viewport output without throwing', () => {
    expect(getCssRectangleFromPdfBounds(pageBounds, {
      width: 200,
      height: 400,
      convertToViewportPoint: () => [Number.NaN, 0],
    }, 200, 400)).toBeNull()
  })

  it('skips a transformed target that lies completely outside the rendered page', () => {
    expect(getCssRectangleFromPdfBounds(pageBounds, {
      width: 200,
      height: 400,
      convertToViewportPoint: () => [500, 500],
    }, 200, 400)).toBeNull()
  })

  it('binds a location request to the active document object and paragraph identity without mutating records', () => {
    const frozenParagraph = Object.freeze({ ...paragraph, pageBounds: Object.freeze({ ...pageBounds }) })
    const request = createParagraphLocationRequest(frozenParagraph, documentProxy, documentId, 4, 'pdf-text', 1)!
    expect(request).toMatchObject({
      documentId,
      paragraphId: paragraph.id,
      sourceTextHash: paragraph.sourceTextHash,
      pageNumber: 4,
      pageBounds,
    })
    expect(isParagraphLocationRequestCurrent(request, documentProxy, documentId, 4)).toBe(true)
    expect(isParagraphLocationRequestCurrent(request, {} as PDFDocumentProxy, documentId, 4)).toBe(false)
    expect(isParagraphLocationRequestCurrent(request, documentProxy, 'sha256:other', 4)).toBe(false)
    expect(isParagraphLocationRequestCurrent(request, documentProxy, documentId, 5)).toBe(false)
    expect(frozenParagraph).toMatchObject({ id: paragraph.id, sourceTextHash: 'source-hash-a', pageBounds })
  })

  it('creates a cross-page search location only for the active PDF and valid paragraph identity', () => {
    const activeDocument = { numPages: 10 } as PDFDocumentProxy
    const request = createParagraphLocationRequestForIdentity(paragraph, activeDocument, documentId, 22)
    expect(request).toMatchObject({
      document: activeDocument,
      documentId,
      paragraphId: paragraph.id,
      sourceTextHash: paragraph.sourceTextHash,
      pageNumber: 4,
      pageBounds,
    })
    expect(createParagraphLocationRequestForIdentity(paragraph, activeDocument, 'sha256:other' as typeof documentId, 23)).toBeNull()
    expect(createParagraphLocationRequestForIdentity({ ...paragraph, sourceTextHash: '' }, activeDocument, documentId, 24)).toBeNull()
    expect(createParagraphLocationRequestForIdentity({ ...paragraph, pageBounds: null }, activeDocument, documentId, 25)).toBeNull()
    expect(createParagraphLocationRequestForIdentity(paragraph, { numPages: 3 } as PDFDocumentProxy, documentId, 26)).toBeNull()
  })

  it('does not activate on a text selection, preserving copy workflows', () => {
    expect(hasActiveParagraphTextSelection(' selected words ')).toBe(true)
    expect(hasActiveParagraphTextSelection('')).toBe(false)
    expect(hasActiveParagraphTextSelection(null)).toBe(false)
  })

  it('routes source and translated paragraph activation through the same unchanged paragraph identity', () => {
    for (const label of ['source', 'translation']) {
      const located: PdfParagraph[] = []
      const activated = activateParagraphLocation(paragraph, '', (value) => located.push(value))
      expect(activated, label).toBe(true)
      expect(located).toEqual([paragraph])
      expect(located[0]).toMatchObject({ id: paragraph.id, sourceTextHash: paragraph.sourceTextHash })
    }
  })

  it('does not locate when mouse activation follows selection for copying', () => {
    const located: PdfParagraph[] = []
    expect(activateParagraphLocation(paragraph, 'copied words', (value) => located.push(value))).toBe(false)
    expect(located).toEqual([])
  })
})
