import { describe, expect, it } from 'vitest'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { getPageNumberFromInput, organizePageText, type NeighborPageTextLayout } from './pdfText'
import { noteRecordMatchesParagraph, translationRecordMatchesParagraph, versionedTranslationRecordId } from './readerResultsStore'
import type { NoteRecord, TranslationRecord } from './pdfTypes'

function textContent(items: Array<{ str: string; x: number; y: number; width: number; height?: number }>) {
  return {
    items: items.map((item) => ({
      str: item.str,
      dir: 'ltr',
      transform: [1, 0, 0, item.height ?? 10, item.x, item.y],
      width: item.width,
      height: item.height ?? 10,
      fontName: 'Helvetica',
      hasEOL: true,
    })),
    styles: {},
    lang: 'en',
  } as TextContent
}

function runningHeadPage(pageNumber: number, header: string, body: string[] = ['Body begins here.', 'A continuing line.', 'A final body line.']): NeighborPageTextLayout {
  return {
    pageNumber,
    pageHeight: 792,
    content: textContent([
      { str: header, x: pageNumber % 2 === 0 ? 160 : 310, y: 657, width: 100, height: 11 },
      ...body.map((str, index) => ({ str, x: index === 3 ? 171 : 160, y: 625 - index * 14, width: 180, height: 11 })),
    ]),
  }
}

describe('PDF page text organization', () => {
  it('filters repeated alternating folios only with adjacent title and sequential page-number evidence', async () => {
    const documentId = `sha256:${'c'.repeat(64)}` as const
    const pageLayouts = new Map<number, NeighborPageTextLayout>([
      [75, runningHeadPage(75, 'tone . 65')],
      [76, runningHeadPage(76, '66 . tone')],
      [77, runningHeadPage(77, 'tone . 67', [
        'CM and the stranger enter the argument.',
        'The body continues at the same font size.',
        'noise.',
        'Thus, while the transactions unfold, the argument shifts.',
        'A continuation line remains in this paragraph.',
        '2021, 47, and 3 remain ordinary body numbers.',
      ])],
      [78, runningHeadPage(78, '68 . tone')],
      [79, runningHeadPage(79, 'tone . 69')],
      [80, runningHeadPage(80, '70 . tone')],
      [81, runningHeadPage(81, 'tone . 71')],
    ])
    const originalPage77 = pageLayouts.get(77)!
    const originalItems = structuredClone(originalPage77.content.items)

    const results = new Map<number, Awaited<ReturnType<typeof organizePageText>>>()
    for (let pageNumber = 76; pageNumber <= 80; pageNumber += 1) {
      const current = pageLayouts.get(pageNumber)!
      results.set(pageNumber, await organizePageText(current.content, pageNumber, documentId, {
        pageHeight: current.pageHeight,
        previousPage: pageLayouts.get(pageNumber - 1),
        nextPage: pageLayouts.get(pageNumber + 1),
      }))
    }

    for (const [pageNumber, result] of results) {
      const bodyText = result.paragraphs.map((paragraph) => paragraph.text).join('\n')
      expect(bodyText).not.toMatch(/(?:66\s*\.\s*tone|tone\s*\.\s*67|68\s*\.\s*tone|tone\s*\.\s*69|70\s*\.\s*tone)/u)
      expect(result.items.some((item) => item.y === 657 && /tone/u.test(item.text))).toBe(true)
      expect(result.paragraphs.map((paragraph) => paragraph.paragraphIndex)).toEqual(result.paragraphs.map((_, index) => index + 1))
      expect(result.paragraphs.every((paragraph) => paragraph.id.startsWith(`${documentId}:page:${pageNumber}:paragraph:`))).toBe(true)
    }

    const page77 = results.get(77)!
    expect(page77.paragraphs[0]?.text).toContain('CM and the stranger')
    const thusIndex = page77.paragraphs.findIndex((paragraph) => paragraph.text.startsWith('Thus, while'))
    expect(thusIndex).toBeGreaterThan(0)
    expect(page77.paragraphs[thusIndex - 1]?.text).not.toContain('Thus, while')
    expect(page77.paragraphs[thusIndex]?.paragraphIndex).toBe(thusIndex + 1)
    expect(page77.paragraphs.map((paragraph) => paragraph.text).join('\n')).toContain('2021, 47, and 3 remain ordinary body numbers.')
    expect(originalPage77.content.items).toEqual(originalItems)
    expect(page77.items.some((item) => item.y === 657 && /tone/u.test(item.text))).toBe(true)
  })

  it('keeps a top title and number-like text when repetition and page progression are not proven', async () => {
    const documentId = `sha256:${'c'.repeat(64)}` as const
    const current = runningHeadPage(77, '41 . Chapter Two', ['Short title at the top.', 'Year 2021 and footnote 47.', 'Regular body line.'])
    const previous = runningHeadPage(76, '40 . Chapter Two')
    const next = runningHeadPage(78, '43 . Chapter Two')
    const result = await organizePageText(current.content, 77, documentId, {
      pageHeight: current.pageHeight,
      previousPage: previous,
      nextPage: next,
    })
    expect(result.paragraphs.map((paragraph) => paragraph.text).join('\n')).toContain('41 . Chapter Two')
    expect(result.paragraphs.map((paragraph) => paragraph.text).join('\n')).toContain('Year 2021 and footnote 47.')
  })

  it('keeps a suspected folio when adjacent-page evidence is unavailable', async () => {
    const documentId = `sha256:${'c'.repeat(64)}` as const
    const current = runningHeadPage(77, 'tone . 67')
    const result = await organizePageText(current.content, 77, documentId, { pageHeight: current.pageHeight })
    expect(result.paragraphs.map((paragraph) => paragraph.text).join('\n')).toContain('tone . 67')
  })

  it('does not auto-associate historical notes or translations after paragraph numbering shifts', async () => {
    const documentId = `sha256:${'c'.repeat(64)}` as const
    const page = runningHeadPage(77, 'tone . 67', ['New paragraph now has index one.', 'A second line follows.', 'Third body line.'])
    const result = await organizePageText(page.content, 77, documentId, {
      pageHeight: page.pageHeight,
      previousPage: runningHeadPage(76, '66 . tone'),
      nextPage: runningHeadPage(78, '68 . tone'),
    })
    const currentParagraph = result.paragraphs[0]!
    const oldParagraphId = `${documentId}:page:77:paragraph:1`
    const historicalNote: NoteRecord = {
      id: `note:${documentId}:${oldParagraphId}:source:old-hash`, documentId, paragraphId: oldParagraphId,
      sourceTextHash: 'old-hash', pageNumber: 77, text: 'Historical note.', updatedAt: 1,
    }
    const historicalTranslation: TranslationRecord = {
      id: versionedTranslationRecordId(oldParagraphId, 'zh-CN', 'en', 'old-hash', 1), documentId,
      paragraphId: oldParagraphId, sourceTextHash: 'old-hash', sourceLanguage: 'en', targetLanguage: 'zh-CN',
      translatedText: 'Historical translation.', createdAt: 1, preprocessingVersion: 1,
    }
    expect(currentParagraph.id).toBe(oldParagraphId)
    expect(noteRecordMatchesParagraph(historicalNote, currentParagraph)).toBe(false)
    expect(translationRecordMatchesParagraph(historicalTranslation, currentParagraph, 1)).toBe(false)
  })

  it('preserves source page and stable paragraph identifiers while grouping lines', async () => {
    const documentId = `sha256:${'a'.repeat(64)}` as const
    const result = await organizePageText(textContent([
      { str: 'First', x: 72, y: 700, width: 24 },
      { str: 'paragraph line one', x: 101, y: 700, width: 90 },
      { str: 'and line two.', x: 72, y: 686, width: 70 },
      { str: 'Second paragraph.', x: 72, y: 650, width: 95 },
    ]), 4, documentId)

    expect(result.pageNumber).toBe(4)
    expect(result.paragraphs).toHaveLength(2)
    expect(result.paragraphs[0]).toMatchObject({
      id: `${documentId}:page:4:paragraph:1`,
      documentId,
      pageNumber: 4,
      paragraphIndex: 1,
      text: 'First paragraph line one\nand line two.',
    })
    expect(result.paragraphs[1].id).toBe(`${documentId}:page:4:paragraph:2`)
    expect(result.paragraphs[0].sourceTextHash).toMatch(/^[a-f\d]{64}$/)
    expect(result.paragraphs[0].pageBounds).toMatchObject({ coordinateSystem: 'pdf-user-space' })
    expect(result.items[0]).toMatchObject({ text: 'First', x: 72, y: 700 })
  })

  it('returns an empty page result instead of inventing text for a scan', async () => {
    expect(await organizePageText(textContent([]), 2, `sha256:${'b'.repeat(64)}`)).toMatchObject({
      pageNumber: 2,
      items: [],
      paragraphs: [],
    })
  })

  it('keeps Japanese Unicode text during paragraph organization', async () => {
    const documentId = `sha256:${'d'.repeat(64)}` as const
    const result = await organizePageText(textContent([
      { str: 'この研究では日本語の原文を保持します。', x: 72, y: 700, width: 190 },
    ]), 5, documentId)
    expect(result.paragraphs).toHaveLength(1)
    expect(result.paragraphs[0].text).toBe('この研究では日本語の原文を保持します。')
    expect(result.paragraphs[0].pageNumber).toBe(5)
  })

  it('splits a first-line indent when the preceding line is at the body margin', async () => {
    const result = await organizePageText(textContent([
      { str: 'Running header', x: 72, y: 760, width: 80 },
      { str: 'Opening line.', x: 72, y: 720, width: 62 },
      { str: 'The preceding paragraph ends here.', x: 72, y: 706, width: 160 },
      { str: 'Thus, a new paragraph begins.', x: 83, y: 692, width: 140 },
      { str: 'Its next visual line remains together.', x: 72, y: 678, width: 170 },
      { str: 'And another continuation line.', x: 72, y: 664, width: 145 },
    ]), 77, `sha256:${'e'.repeat(64)}`)
    expect(result.paragraphs).toHaveLength(3)
    expect(result.paragraphs[1].text).toContain('The preceding paragraph ends here.')
    expect(result.paragraphs[1].text).not.toContain('Thus,')
    expect(result.paragraphs[2].text).toBe('Thus, a new paragraph begins.\nIts next visual line remains together.\nAnd another continuation line.')
  })

  it('does not split unindented lines, page-top indentation, lists, or short ambiguous pages', async () => {
    const documentId = `sha256:${'f'.repeat(64)}` as const
    const unindented = await organizePageText(textContent([
      { str: 'Header', x: 72, y: 760, width: 30 },
      { str: 'Body line one.', x: 72, y: 730, width: 60 },
      { str: 'Body line two.', x: 72, y: 716, width: 60 },
      { str: 'Body line three.', x: 72, y: 702, width: 70 },
      { str: 'Body line four.', x: 72, y: 688, width: 65 },
    ]), 3, documentId)
    expect(unindented.paragraphs).toHaveLength(2)

    const list = await organizePageText(textContent([
      { str: 'Page header', x: 72, y: 760, width: 60 },
      { str: 'First body line.', x: 72, y: 730, width: 70 },
      { str: 'Second body line.', x: 72, y: 716, width: 80 },
      { str: '• List item.', x: 83, y: 702, width: 55 },
      { str: 'Continuation.', x: 72, y: 688, width: 60 },
    ]), 3, documentId)
    expect(list.paragraphs).toHaveLength(2)

    const shortPage = await organizePageText(textContent([
      { str: 'Header', x: 72, y: 760, width: 30 },
      { str: 'Body.', x: 72, y: 730, width: 30 },
      { str: 'Indented but uncertain.', x: 83, y: 716, width: 90 },
    ]), 3, documentId)
    expect(shortPage.paragraphs).toHaveLength(2)
  })
})

describe('page number input validation', () => {
  it('accepts only integer pages inside the document bounds', () => {
    expect(getPageNumberFromInput('1', 3)).toBe(1)
    expect(getPageNumberFromInput('3', 3)).toBe(3)
    expect(getPageNumberFromInput('0', 3)).toBeNull()
    expect(getPageNumberFromInput('4', 3)).toBeNull()
    expect(getPageNumberFromInput('1.5', 3)).toBeNull()
    expect(getPageNumberFromInput('', 3)).toBeNull()
  })
})
