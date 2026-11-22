import { describe, expect, it } from 'vitest'
import type { PdfParagraph, PdfTextItem } from '../pdf/pdfTypes'
import { createTranslationRequest } from './translationProvider'
import { prepareTranslationText } from './translationText'
import { translationCacheKey } from '../../../server/translationProtection.mjs'

const documentId = `sha256:${'a'.repeat(64)}` as const

function item(text: string, x: number, y: number, width: number, height: number, lineIndex = 0): PdfTextItem {
  return { text, x, y, width, height, hasLineBreakAfter: false, lineIndex }
}

function paragraph(text: string, items: PdfTextItem[] = []): PdfParagraph {
  return {
    id: `${documentId}:page:4:paragraph:2`,
    documentId,
    pageNumber: 4,
    paragraphIndex: 2,
    text,
    sourceTextHash: 'original-source-hash',
    pageBounds: { coordinateSystem: 'pdf-user-space', x: 10, y: 20, width: 300, height: 40 },
    items,
  }
}

describe('translation-only text preparation', () => {
  it('joins ordinary visual line breaks without changing punctuation or word spacing', () => {
    expect(prepareTranslationText(paragraph('A careful sentence,\nwith necessary spaces.')))
      .toBe('A careful sentence, with necessary spaces.')
    expect(prepareTranslationText(paragraph('A\nB; C.'))).toBe('A B; C.')
  })

  it('removes a geometrically clear superscript citation while retaining display source', () => {
    const original = paragraph('47\nA cited sentence.', [
      item('A cited sentence.', 10, 100, 75, 10, 1),
      item('47', 87, 103, 8, 5, 0),
    ])
    const originalText = original.text
    const translatedRequest = createTranslationRequest(original, 'en')
    expect(translatedRequest.sourceText).toBe('A cited sentence.')
    expect(translatedRequest.paragraphId).toBe(original.id)
    expect(translatedRequest.sourceTextHash).toBe(original.sourceTextHash)
    expect(original.text).toBe(originalText)

    const unicodeCitation = paragraph('⁴⁷\nA cited sentence.', [
      item('A cited sentence.', 10, 100, 75, 10, 1),
      item('⁴⁷', 87, 103, 8, 5, 0),
    ])
    expect(prepareTranslationText(unicodeCitation)).toBe('A cited sentence.')
  })

  it('filters the real page 77 paragraph 77.5 superscript lines using organizer line associations', () => {
    // Minimal fixture from the real PDF.js extraction of the supplied PDF, page 77.
    // Marker/adjacent item geometry copied from the local diagnostic: 47 (x=197.3387,y=306.0306,h=6)
    // beside “too well.” (x=159.696,y=302.9135638,w=37.6416578,h=10.9999); 48 (x=183.9291,y=194.0303,h=6)
    // beside “noise.” (x=159.7121236,y=190.9076184,w=24.2327797,h=10.9999).
    const realParagraph: PdfParagraph = {
      ...paragraph('by adhering to a rule\n47\ntoo well. Here, the overwhelming response\ndissolves into anaphoric\n48\nnoise. The 1947 study used 12 cases.'),
      id: 'sha256:6e227c47713a5c874aeda75d3b4fef6c9bb30c6a4abdc21ab2767f413dffbf0f:page:77:paragraph:5',
      documentId: 'sha256:6e227c47713a5c874aeda75d3b4fef6c9bb30c6a4abdc21ab2767f413dffbf0f',
      pageNumber: 77,
      paragraphIndex: 5,
      sourceTextHash: 'real-page-77-source-hash-fixture',
      items: [
        { ...item('by adhering to a rule', 100, 313, 90, 10.9999), lineIndex: 0 },
        { ...item('47', 197.3387, 306.0306, 5.328, 6), lineIndex: 1 },
        { ...item('too well.', 159.696, 302.9135638, 37.6416578, 10.9999), lineIndex: 2 },
        { ...item(' Here, the overwhelming response', 197.3376578, 302.9135638, 150, 10.9999), lineIndex: 2 },
        { ...item('dissolves into anaphoric', 100, 201, 83.9, 10.9999), lineIndex: 3 },
        { ...item('48', 183.9291, 194.0303, 5.328, 6), lineIndex: 4 },
        { ...item('noise.', 159.7121236, 190.9076184, 24.2327797, 10.9999), lineIndex: 5 },
        { ...item(' The 1947 study used 12 cases.', 183.9449033, 190.9076184, 140, 10.9999), lineIndex: 5 },
      ],
    }
    const originalText = realParagraph.text
    const request = createTranslationRequest(realParagraph, 'en')
    expect(request.sourceText).toBe('by adhering to a rule too well. Here, the overwhelming response dissolves into anaphoric noise. The 1947 study used 12 cases.')
    expect(request.sourceText).not.toMatch(/\b(?:47|48)\b/u)
    expect(request.paragraphId).toBe(realParagraph.id)
    expect(request.sourceTextHash).toBe(realParagraph.sourceTextHash)
    expect(realParagraph.text).toBe(originalText)
    expect(realParagraph.text).toContain('\n47\n')
    expect(realParagraph.text).toContain('\n48\n')
    expect(request.sourceText).toContain('1947')
    expect(request.sourceText).toContain('12 cases')
  })

  it('keeps ordinary years and inline numbers on the text baseline', () => {
    const source = paragraph('The study began in 1947.', [
      item('The study began in 1947.', 10, 100, 130, 10),
    ])
    expect(prepareTranslationText(source)).toBe(source.text)
  })

  it('keeps small numbers when baseline or adjacency evidence is insufficient', () => {
    const baselineNumber = paragraph('A value 47 remains.', [
      item('A value', 10, 100, 42, 10),
      item('47', 54, 100, 8, 5),
      item(' remains.', 62, 100, 45, 10),
    ])
    const detachedNumber = paragraph('A sentence. 47', [
      item('A sentence.', 10, 100, 48, 10),
      item('47', 100, 103, 8, 5),
    ])
    const mathematicalPower = paragraph('x2', [
      item('x', 10, 100, 5, 10),
      item('2', 15, 103, 4, 5),
    ])
    expect(prepareTranslationText(baselineNumber)).toBe(baselineNumber.text)
    expect(prepareTranslationText(detachedNumber)).toBe(detachedNumber.text)
    expect(prepareTranslationText(mathematicalPower)).toBe(mathematicalPower.text)
  })

  it('does not filter OCR digits and only folds its visual newlines', () => {
    const ocrParagraph = paragraph('The date was 1912.\nFootnote 32 remains.', [])
    expect(prepareTranslationText(ocrParagraph)).toBe('The date was 1912. Footnote 32 remains.')
  })

  it('uses prepared text in the translation request while retaining paragraph identity and geometry', () => {
    const source = paragraph('First line\nsecond line.', [])
    const request = createTranslationRequest(source, 'en')
    expect(request.sourceText).toBe('First line second line.')
    expect(request.paragraphId).toBe(source.id)
    expect(request.documentId).toBe(source.documentId)
    expect(request.sourceTextHash).toBe(source.sourceTextHash)
    expect(source.pageNumber).toBe(4)
    expect(source.pageBounds?.x).toBe(10)
    expect(translationCacheKey(request.sourceText, 'en', 'zh-CN'))
      .toBe(translationCacheKey('First line second line.', 'en', 'zh-CN'))
    expect(translationCacheKey('same text', 'en', 'zh-CN', 0))
      .not.toBe(translationCacheKey('same text', 'en', 'zh-CN', 1))
  })
})
