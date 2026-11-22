import { describe, expect, it } from 'vitest'
import type { PdfParagraph } from './pdfTypes'
import { prepareOcrParagraphDisplayText, prepareParagraphDisplayText } from './displayText'

function paragraph(text: string): PdfParagraph {
  return {
    id: 'sha256:abc:page:77:paragraph:5', documentId: 'sha256:abc', pageNumber: 77, paragraphIndex: 5,
    text, sourceTextHash: 'fixed-source-hash', pageBounds: null, items: [],
  }
}

describe('paragraph display text', () => {
  it('joins ordinary visual line breaks with spaces', () => {
    expect(prepareParagraphDisplayText(paragraph('A visual line\nbreak becomes continuous.')))
      .toBe('A visual line break becomes continuous.')
  })

  it.each([
    ['contrast-\ning', 'contrasting'],
    ['de-\nceptive', 'deceptive'],
  ])('repairs confirmed line-wrap word %s', (source, expected) => {
    expect(prepareParagraphDisplayText(paragraph(source))).toBe(expected)
  })

  it('preserves legitimate hyphens and footnote digits', () => {
    expect(prepareParagraphDisplayText(paragraph('The co-assembled account cites 47.')))
      .toBe('The co-assembled account cites 47.')
    expect(prepareParagraphDisplayText(paragraph('The co-\nassembled account cites 47.')))
      .toBe('The co- assembled account cites 47.')
  })

  it('keeps separate paragraph records independent and leaves source identity unchanged', () => {
    const source = paragraph('First paragraph ends.')
    const next = paragraph('Second paragraph starts.')
    const snapshot = { text: source.text, id: source.id, sourceTextHash: source.sourceTextHash }
    expect(prepareParagraphDisplayText(source)).toBe('First paragraph ends.')
    expect(prepareParagraphDisplayText(next)).toBe('Second paragraph starts.')
    expect({ text: source.text, id: source.id, sourceTextHash: source.sourceTextHash }).toEqual(snapshot)
  })
})

describe('OCR paragraph display text', () => {
  it('joins adjacent Japanese kanji and kana across a single OCR line break without a space', () => {
    expect(prepareOcrParagraphDisplayText(paragraph('彼\nらは紅衛\n兵だった')))
      .toBe('彼らは紅衛兵だった')
  })

  it('joins Japanese punctuation boundaries conservatively', () => {
    expect(prepareOcrParagraphDisplayText(paragraph('激し\nく、彼らは\n進んだ。')))
      .toBe('激しく、彼らは進んだ。')
  })

  it('preserves ordinary spaces already present in OCR text', () => {
    expect(prepareOcrParagraphDisplayText(paragraph('彼 ら\nは紅衛 兵')))
      .toBe('彼 らは紅衛 兵')
  })

  it('does not treat a blank-line boundary as a Japanese visual wrap', () => {
    expect(prepareOcrParagraphDisplayText(paragraph('彼らは\n\n次の段落')))
      .toBe('彼らは\n\n次の段落')
  })

  it('keeps non-Japanese, numeric, list, and hyphenated line boundaries on the existing spaced path', () => {
    expect(prepareOcrParagraphDisplayText(paragraph('English\ntext'))).toBe('English text')
    expect(prepareOcrParagraphDisplayText(paragraph('第 2\n章'))).toBe('第 2 章')
    expect(prepareOcrParagraphDisplayText(paragraph('本文\n・項目'))).toBe('本文 ・項目')
    expect(prepareOcrParagraphDisplayText(paragraph('リーターで-\nもあった'))).toBe('リーターで- もあった')
  })

  it('keeps separate title and body paragraph records independent', () => {
    const title = paragraph('2.1\n序章')
    const body = { ...paragraph('本文が続く'), id: 'sha256:abc:page:77:paragraph:6' }
    expect(prepareOcrParagraphDisplayText(title)).toBe('2.1 序章')
    expect(prepareOcrParagraphDisplayText(body)).toBe('本文が続く')
  })

  it('does not change the source text or paragraph identity fields', () => {
    const source = paragraph('彼\nらは紅衛\n兵だった')
    const before = { text: source.text, id: source.id, sourceTextHash: source.sourceTextHash }
    expect(prepareOcrParagraphDisplayText(source)).toBe('彼らは紅衛兵だった')
    expect({ text: source.text, id: source.id, sourceTextHash: source.sourceTextHash }).toEqual(before)
  })

  it('keeps the existing PDF text-layer display behavior for the same text', () => {
    expect(prepareParagraphDisplayText(paragraph('彼\nらは紅衛\n兵だった')))
      .toBe('彼 らは紅衛 兵だった')
  })
})
