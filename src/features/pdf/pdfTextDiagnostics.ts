import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'

export type PdfTextDiagnosticCategory =
  | 'no-items'
  | 'items-without-text-runs'
  | 'text-items-empty'
  | 'japanese-text-not-organized'
  | 'readable-text-not-organized'
  | 'text-extracted'

export type PdfTextContentSummary = {
  itemsLength: number
  textItemCount: number
  nonEmptyTextItemCount: number
  japaneseTextItemCount: number
}

function isTextItem(item: TextContent['items'][number]): item is TextItem {
  return 'str' in item && 'transform' in item
}

/** Return content-free counts for diagnostics; never include PDF text in the summary. */
export function summarizePdfTextContent(content: TextContent): PdfTextContentSummary {
  const textItems = content.items.filter(isTextItem)
  const nonEmptyTextItems = textItems.filter((item) => item.str.trim().length > 0)
  const japaneseTextItems = nonEmptyTextItems.filter((item) => /[\u3040-\u30ff\u4e00-\u9faf]/u.test(item.str))
  return {
    itemsLength: content.items.length,
    textItemCount: textItems.length,
    nonEmptyTextItemCount: nonEmptyTextItems.length,
    japaneseTextItemCount: japaneseTextItems.length,
  }
}

export function classifyPdfTextExtraction(
  summary: PdfTextContentSummary,
  paragraphCount: number,
): PdfTextDiagnosticCategory {
  if (summary.itemsLength === 0) return 'no-items'
  if (summary.textItemCount === 0) return 'items-without-text-runs'
  if (summary.nonEmptyTextItemCount === 0) return 'text-items-empty'
  if (paragraphCount > 0) return 'text-extracted'
  if (summary.japaneseTextItemCount > 0) return 'japanese-text-not-organized'
  return 'readable-text-not-organized'
}
