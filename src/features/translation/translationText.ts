import type { PdfParagraph, PdfTextItem } from '../pdf/pdfTypes'

export const TRANSLATION_PREPROCESSING_VERSION = 1

const superscriptOrFootnoteNumber = /^(?:[0-9]{1,3}|[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3})$/u

function renderLine(items: readonly PdfTextItem[]): string {
  return items.reduce((text, item, index) => {
    if (index === 0) return item.text
    const previous = items[index - 1]
    const gap = item.x - (previous.x + previous.width)
    const needsSpace = gap > Math.max(1.5, Math.min(previous.height, item.height) * 0.16)
      && !text.endsWith(' ')
      && !item.text.startsWith(' ')
    return `${text}${needsSpace ? ' ' : ''}${item.text}`
  }, '').trim()
}

function isConfidentSuperscriptCitation(candidate: PdfTextItem, allItems: readonly PdfTextItem[]): boolean {
  if (!superscriptOrFootnoteNumber.test(candidate.text.trim())) return false

  const previous = allItems
    .filter((item) => item !== candidate
      && item.height > candidate.height * 1.28
      && item.x + item.width <= candidate.x + 0.5
      && candidate.y >= item.y)
    .map((item) => ({ item, gap: candidate.x - (item.x + item.width) }))
    .filter(({ item, gap }) => gap >= -0.5 && gap <= Math.max(2, item.height * 0.3))
    .sort((a, b) => b.item.x + b.item.width - (a.item.x + a.item.width))[0]?.item
  if (!previous) return false

  const bodyHeight = previous.height
  const sizeRatio = candidate.height / bodyHeight
  const baselineRise = candidate.y - previous.y
  const horizontalGap = candidate.x - (previous.x + previous.width)
  const previousText = previous.text.trim()
  const previousLastCharacter = [...previousText].at(-1) ?? ''
  const followsText = /[\p{L}\p{M})\]}"'’”.,!?;:]$/u.test(previousLastCharacter)
  const looksLikeSingleLetterVariable = /^[\p{L}]$/u.test(previousText)

  return bodyHeight > 0
    && sizeRatio <= 0.78
    && baselineRise >= Math.max(1.25, bodyHeight * 0.18)
    && baselineRise <= bodyHeight * 0.85
    && horizontalGap >= -0.5
    && horizontalGap <= Math.max(2, bodyHeight * 0.3)
    && followsText
    && !looksLikeSingleLetterVariable
}

/**
 * Prepares a translation-only view of a paragraph. The immutable source text remains
 * untouched for display, IDs, notes, and source-text integrity checks.
 */
export function prepareTranslationText(paragraph: PdfParagraph): string {
  if (!paragraph.items.length) return paragraph.text.replace(/\s*\n\s*/gu, ' ').trim()
  if (paragraph.items.some((item) => !Number.isSafeInteger(item.lineIndex) || item.lineIndex! < 0)) {
    return paragraph.text.replace(/\s*\n\s*/gu, ' ').trim()
  }
  const grouped = new Map<number, PdfTextItem[]>()
  for (const item of paragraph.items) grouped.set(item.lineIndex!, [...(grouped.get(item.lineIndex!) ?? []), item])
  const lines = [...grouped.entries()].sort(([a], [b]) => a - b).map(([lineIndex, items]) => ({ lineIndex, items: [...items].sort((a, b) => a.x - b.x) }))
  const originalLines = paragraph.text.split('\n').map((line) => line.trim()).filter(Boolean)
  const originalFromGeometry = lines.map(({ items }) => renderLine(items))
  // Do not infer new line groups; if the organizer's recorded lines do not match the source, preserve all digits.
  if (originalFromGeometry.length !== originalLines.length
    || originalFromGeometry.some((line, index) => line !== originalLines[index])) {
    return paragraph.text.replace(/\s*\n\s*/gu, ' ').trim()
  }

  const translationLines = lines.map(({ items }) => {
    const removed = new Set<PdfTextItem>()
    for (const item of items) {
      if (isConfidentSuperscriptCitation(item, paragraph.items)) removed.add(item)
    }
    return renderLine(items.filter((item) => !removed.has(item)))
  })

  return translationLines.filter(Boolean).join('\n').replace(/\s*\n\s*/gu, ' ').trim()
}
