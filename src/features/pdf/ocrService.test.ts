import { describe, expect, it } from 'vitest'
import type { PdfPageText } from './pdfTypes'
import { normalizeOcrText, shouldRunOcr } from './ocrService'

describe('on-demand OCR decisions', () => {
  it('does not run OCR when the PDF text layer already produced paragraphs', () => {
    const textPage = {
      pageNumber: 1,
      items: [],
      paragraphs: [{ text: 'A genuine text layer paragraph.' }],
      extractedAt: 1,
      source: 'pdf-text',
    } as unknown as PdfPageText
    expect(shouldRunOcr(textPage)).toBe(false)
  })

  it('runs OCR only after a page extraction completed without paragraphs', () => {
    const imageOnlyPage = { pageNumber: 1, items: [], paragraphs: [], extractedAt: 1 } as PdfPageText
    expect(shouldRunOcr(imageOnlyPage)).toBe(true)
    expect(shouldRunOcr(null)).toBe(false)
  })

  it('treats blank and very low-confidence OCR output as empty rather than displaying noise', () => {
    expect(normalizeOcrText('  \n ', 92)).toBe('')
    expect(normalizeOcrText('文字化けのようなノイズ', 8)).toBe('')
    expect(normalizeOcrText('日本語のテキスト', 82)).toBe('日本語のテキスト')
  })
})
