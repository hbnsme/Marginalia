import { describe, expect, it } from 'vitest'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { classifyPdfTextExtraction, summarizePdfTextContent } from './pdfTextDiagnostics'

function content(items: unknown[]) {
  return { items, styles: {} } as TextContent
}

function textItem(str: string) {
  return { str, transform: [1, 0, 0, 10, 0, 0], width: 10, height: 10, hasEOL: true }
}

describe('PDF text extraction diagnostics', () => {
  it('distinguishes missing items, empty text strings, and Japanese text lost after organization', () => {
    const noItems = summarizePdfTextContent(content([]))
    expect(classifyPdfTextExtraction(noItems, 0)).toBe('no-items')

    const emptyStrings = summarizePdfTextContent(content([textItem(''), textItem('  ')]))
    expect(classifyPdfTextExtraction(emptyStrings, 0)).toBe('text-items-empty')

    const japaneseText = summarizePdfTextContent(content([textItem('日文原文を検出しました。')]))
    expect(japaneseText.japaneseTextItemCount).toBe(1)
    expect(classifyPdfTextExtraction(japaneseText, 0)).toBe('japanese-text-not-organized')
  })

  it('reports content-free counts without including PDF text in the diagnostic summary', () => {
    const longJapaneseText = 'あ'.repeat(40)
    const summary = summarizePdfTextContent(content([textItem(''), textItem(longJapaneseText)]))
    expect(summary).toEqual({
      itemsLength: 2,
      textItemCount: 2,
      nonEmptyTextItemCount: 1,
      japaneseTextItemCount: 1,
    })
    expect(JSON.stringify(summary)).not.toContain(longJapaneseText)
  })
})
