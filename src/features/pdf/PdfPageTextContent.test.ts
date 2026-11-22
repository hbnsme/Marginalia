import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PdfPageText } from './pdfTypes'
import { getPdfPageTextDisplayState, PdfPageTextContent } from './PdfPageTextContent'

const emptyPage: PdfPageText = { pageNumber: 1, items: [], paragraphs: [], extractedAt: 1 }

describe('PDF text panel states', () => {
  it('keeps no-text results distinct from extraction errors', () => {
    expect(getPdfPageTextDisplayState({ isLoading: false, hasError: false, pageText: emptyPage })).toBe('no-text')
    expect(getPdfPageTextDisplayState({ isLoading: false, hasError: true, pageText: null })).toBe('error')
    expect(getPdfPageTextDisplayState({ isLoading: true, hasError: false, pageText: null })).toBe('loading')
  })

  it('shows an OCR retry action for OCR failures instead of the blank-page message', () => {
    const markup = renderToStaticMarkup(createElement(PdfPageTextContent, {
      isLoading: false,
      hasError: false,
      pageText: emptyPage,
      ocrFailed: true,
      onRetryOcr: () => undefined,
    }))
    expect(markup).toContain('本页 OCR 识别失败')
    expect(markup).toContain('重试 OCR')
    expect(markup).not.toContain('OCR 已完成，但本页没有识别到可读取文字')
  })

  it('labels OCR-derived text distinctly from PDF text-layer text', () => {
    const ocrPage: PdfPageText = {
      pageNumber: 1,
      items: [],
      paragraphs: [{
        id: 'paragraph-1', documentId: 'sha256:test', pageNumber: 1, paragraphIndex: 1,
        text: 'OCR recognized line.', sourceTextHash: 'hash', pageBounds: null, items: [],
      }],
      extractedAt: 1,
      source: 'ocr',
    }
    const markup = renderToStaticMarkup(createElement(PdfPageTextContent, {
      isLoading: false, hasError: false, pageText: ocrPage,
    }))
    expect(markup).toContain('本地 OCR 识别结果')
    expect(markup).toContain('OCR recognized line.')
  })

  it('renders paragraph actions alongside extracted source text', () => {
    const pageText: PdfPageText = {
      pageNumber: 1,
      items: [],
      paragraphs: [{
        id: 'paragraph-1', documentId: 'sha256:test', pageNumber: 1, paragraphIndex: 1,
        text: 'Source remains visible.', sourceTextHash: 'hash', pageBounds: null, items: [],
      }],
      extractedAt: 1,
    }
    const markup = renderToStaticMarkup(createElement(PdfPageTextContent, {
      isLoading: false,
      hasError: false,
      pageText,
      renderParagraphActions: () => createElement('button', null, '添加批注'),
    }))
    expect(markup).toContain('Source remains visible.')
    expect(markup).toContain('添加批注')
  })

  it('makes valid PDF text paragraphs keyboard-accessible location controls while keeping note actions separate', () => {
    const paragraph = {
      id: 'sha256:test:page:2:paragraph:1', documentId: 'sha256:test' as const,
      pageNumber: 2, paragraphIndex: 1, text: 'Source paragraph.', sourceTextHash: 'source-hash',
      pageBounds: { coordinateSystem: 'pdf-user-space' as const, x: 10, y: 20, width: 100, height: 24 }, items: [],
    }
    const pageText: PdfPageText = { pageNumber: 2, items: [], paragraphs: [paragraph], extractedAt: 1, source: 'pdf-text' }
    const markup = renderToStaticMarkup(createElement(PdfPageTextContent, {
      isLoading: false,
      hasError: false,
      pageText,
      documentId: 'sha256:test',
      onLocateParagraph: () => undefined,
      renderParagraphActions: () => createElement('button', null, '保存批注'),
    }))

    expect(markup).toContain('aria-label="在 PDF 中定位原文第 2.1 段"')
    expect(markup).toContain('Source paragraph.')
    expect(markup).toContain('保存批注')
    expect(markup.indexOf('保存批注')).toBeGreaterThan(markup.indexOf('</button>'))
  })

  it('does not expose location controls for OCR paragraphs even when a callback is supplied', () => {
    const pageText: PdfPageText = {
      pageNumber: 1,
      items: [],
      paragraphs: [{
        id: 'paragraph-ocr', documentId: 'sha256:test', pageNumber: 1, paragraphIndex: 1,
        text: 'OCR text.', sourceTextHash: 'hash', pageBounds: null, items: [],
      }],
      extractedAt: 1,
      source: 'ocr',
    }
    const markup = renderToStaticMarkup(createElement(PdfPageTextContent, {
      isLoading: false, hasError: false, pageText, documentId: 'sha256:test', onLocateParagraph: () => undefined,
    }))
    expect(markup).toContain('OCR text.')
    expect(markup).not.toContain('paragraph-location-button')
  })

})
