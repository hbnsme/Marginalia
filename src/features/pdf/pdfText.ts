import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'
import type { DocumentId, PdfPageText, PdfParagraph, PdfTextItem } from './pdfTypes'
import { createParagraphId, hashSourceText } from './documentIdentity'

type PositionedItem = PdfTextItem & { right: number }
type TextLine = { baseline: number; height: number; items: PositionedItem[] }
export type NeighborPageTextLayout = { pageNumber: number; content: TextContent; pageHeight: number }
export type OrganizePageTextOptions = {
  pageHeight?: number
  previousPage?: NeighborPageTextLayout | null
  nextPage?: NeighborPageTextLayout | null
}

function isTextItem(item: TextContent['items'][number]): item is TextItem {
  return 'str' in item && 'transform' in item
}

function hasGapBetween(previous: PositionedItem, next: PositionedItem) {
  const horizontalGap = next.x - previous.right
  return horizontalGap > Math.max(1.5, Math.min(previous.height, next.height) * 0.16)
}

function lineText(items: PositionedItem[]) {
  return items.reduce((text, item, index) => {
    if (index === 0) return item.text
    const previous = items[index - 1]
    const needsSpace = hasGapBetween(previous, item)
      && !text.endsWith(' ')
      && !item.text.startsWith(' ')
    return `${text}${needsSpace ? ' ' : ''}${item.text}`
  }, '').trim()
}

function getPositionedItems(content: TextContent): PositionedItem[] {
  return content.items.flatMap((item) => {
    if (!isTextItem(item) || !item.str.trim()) return []
    const x = Number(item.transform[4]) || 0
    const y = Number(item.transform[5]) || 0
    const height = Math.max(1, Number(item.height) || Math.abs(Number(item.transform[3])) || 1)
    const width = Math.max(0, Number(item.width) || 0)
    return [{
      text: item.str,
      x,
      y,
      width,
      height,
      hasLineBreakAfter: item.hasEOL,
      right: x + width,
    }]
  })
}

function groupTextLines(items: readonly PositionedItem[]): TextLine[] {
  const lines: TextLine[] = []
  for (const item of items) {
    const matchingLine = lines.find((line) => Math.abs(line.baseline - item.y) <= Math.max(2, item.height * 0.3))
    if (matchingLine) {
      matchingLine.items.push(item)
      matchingLine.height = Math.max(matchingLine.height, item.height)
    } else {
      lines.push({ baseline: item.y, height: item.height, items: [item] })
    }
  }
  lines.sort((a, b) => b.baseline - a.baseline)
  lines.forEach((line) => line.items.sort((a, b) => a.x - b.x))
  return lines
}

type RunningMatterSignature = { printedPageNumber: number; title: string }

function textLineIdentity(line: TextLine) {
  const x = Math.min(...line.items.map((item) => item.x))
  return `${Math.round(line.baseline * 100) / 100}:${Math.round(x * 100) / 100}:${lineText(line.items)}`
}

function parseRunningMatterSignature(line: TextLine): RunningMatterSignature | null {
  const text = lineText(line.items).replace(/\s+/gu, ' ').trim()
  const numberOnLeft = /^(\d{1,4})\s*[.·•]\s*(.+)$/u.exec(text)
  const numberOnRight = /^(.+?)\s*[.·•]\s*(\d{1,4})$/u.exec(text)
  const printedPageNumber = numberOnLeft ? Number(numberOnLeft[1]) : Number(numberOnRight?.[2])
  const rawTitle = numberOnLeft?.[2] ?? numberOnRight?.[1]
  if (!rawTitle || !Number.isSafeInteger(printedPageNumber) || printedPageNumber < 1) return null
  const title = rawTitle.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
  const titleLetters = title.replace(/[^\p{L}\p{M}]/gu, '')
  if (titleLetters.length < 3 || !/^[\p{L}\p{M}][\p{L}\p{M}\s'’\-]{1,60}$/u.test(title)) return null
  return { printedPageNumber, title }
}

function hasHeaderGeometry(line: TextLine, allLines: readonly TextLine[], pageHeight: number): boolean {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0 || line.height < 7) return false
  const topPosition = line.baseline / pageHeight
  if (topPosition < 0.75 || topPosition > 1.02) return false
  const nearestBodyLine = allLines
    .filter((candidate) => candidate.baseline < line.baseline)
    .sort((a, b) => b.baseline - a.baseline)[0]
  return Boolean(nearestBodyLine && line.baseline - nearestBodyLine.baseline >= line.height * 1.8)
}

function runningMatterCandidates(layout: NeighborPageTextLayout): Array<{ signature: RunningMatterSignature; line: TextLine }> {
  const lines = groupTextLines(getPositionedItems(layout.content))
  return lines.flatMap((line) => {
    const signature = parseRunningMatterSignature(line)
    return signature && hasHeaderGeometry(line, lines, layout.pageHeight) ? [{ signature, line }] : []
  })
}

/**
 * Finds only page-top folios whose title repeats on both adjacent PDF pages and
 * whose printed number advances with the PDF page sequence. Missing neighbor
 * evidence always means keep the text.
 */
function findRepeatedRunningMatterLines(
  content: TextContent,
  pageNumber: number,
  pageHeight: number,
  previousPage?: NeighborPageTextLayout | null,
  nextPage?: NeighborPageTextLayout | null,
): ReadonlySet<string> {
  if (!previousPage || !nextPage
    || previousPage.pageNumber !== pageNumber - 1
    || nextPage.pageNumber !== pageNumber + 1) return new Set()
  const currentLines = groupTextLines(getPositionedItems(content))
  const previousCandidates = runningMatterCandidates(previousPage)
  const nextCandidates = runningMatterCandidates(nextPage)
  const removed = new Set<string>()

  for (const line of currentLines) {
    const signature = parseRunningMatterSignature(line)
    if (!signature || !hasHeaderGeometry(line, currentLines, pageHeight)) continue
    const previousMatch = previousCandidates.some(({ signature: candidate, line: neighborLine }) =>
      candidate.title === signature.title
      && candidate.printedPageNumber === signature.printedPageNumber - 1
      && Math.abs(neighborLine.baseline - line.baseline) <= Math.max(line.height * 1.5, pageHeight * 0.025)
      && Math.abs(neighborLine.height - line.height) <= Math.max(line.height * 0.4, 2))
    const nextMatch = nextCandidates.some(({ signature: candidate, line: neighborLine }) =>
      candidate.title === signature.title
      && candidate.printedPageNumber === signature.printedPageNumber + 1
      && Math.abs(neighborLine.baseline - line.baseline) <= Math.max(line.height * 1.5, pageHeight * 0.025)
      && Math.abs(neighborLine.height - line.height) <= Math.max(line.height * 0.4, 2))
    if (previousMatch && nextMatch) removed.add(textLineIdentity(line))
  }
  return removed
}

function estimateBodyLeftEdge(lines: readonly TextLine[]): number | null {
  const candidates = lines.slice(2).filter((line) => line.height >= 7 && line.items.length > 0)
  if (candidates.length < 4) return null
  const bins = new Map<number, number>()
  for (const line of candidates) {
    const bin = Math.round(Math.min(...line.items.map((item) => item.x)) * 2) / 2
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }
  const [left, count] = [...bins.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  return count >= Math.max(3, Math.ceil(candidates.length * 0.25)) ? left : null
}

function isIndentedParagraphStart(
  line: TextLine,
  previousLine: TextLine,
  lineIndex: number,
  bodyLeftEdge: number | null,
): boolean {
  if (bodyLeftEdge === null || lineIndex < 2 || line.height < 7 || previousLine.height < 7) return false
  const text = lineText(line.items)
  if (!text || /^(?:[•·▪◦*-]|\d+[.)]|[([]\d+[)\]])\s/u.test(text)) return false
  const currentX = Math.min(...line.items.map((item) => item.x))
  const previousX = Math.min(...previousLine.items.map((item) => item.x))
  const height = Math.max(line.height, previousLine.height)
  const indent = currentX - bodyLeftEdge
  const gap = previousLine.baseline - line.baseline
  const previousAtMargin = Math.abs(previousX - bodyLeftEdge) <= height * 0.3
  const plausibleIndent = indent >= height * 0.55 && indent <= height * 1.6
  const plausibleLineGap = gap >= height * 1.05 && gap <= height * 1.75
  return previousAtMargin && plausibleIndent && plausibleLineGap
}

/** Organize PDF.js text runs by baseline and vertical spacing, without inventing OCR text. */
export async function organizePageText(
  content: TextContent,
  pageNumber: number,
  documentId: DocumentId,
  options: OrganizePageTextOptions = {},
): Promise<PdfPageText> {
  const items = getPositionedItems(content)
  const lines = groupTextLines(items)
  const excludedRunningMatter = findRepeatedRunningMatterLines(
    content,
    pageNumber,
    options.pageHeight ?? 0,
    options.previousPage,
    options.nextPage,
  )
  const bodyLines = lines.filter((line) => !excludedRunningMatter.has(textLineIdentity(line)))
  const bodyLeftEdge = estimateBodyLeftEdge(bodyLines)

  const paragraphs: PdfParagraph[] = []
  let paragraphLines: TextLine[] = []
  const flushParagraph = async () => {
    if (paragraphLines.length === 0) return
    const paragraphIndex = paragraphs.length + 1
    const nonEmptyLines = paragraphLines
      .map((line) => ({ line, text: lineText(line.items) }))
      .filter(({ text }) => Boolean(text))
    const text = nonEmptyLines.map(({ text: lineValue }) => lineValue).join('\n').trim()
    const paragraphItems = nonEmptyLines.flatMap(({ line }, lineIndex) => line.items.map((item) => ({ ...item, lineIndex })))
    if (text) {
      const x = Math.min(...paragraphItems.map((item) => item.x))
      const y = Math.min(...paragraphItems.map((item) => item.y))
      const right = Math.max(...paragraphItems.map((item) => item.x + item.width))
      const top = Math.max(...paragraphItems.map((item) => item.y + item.height))
      paragraphs.push({
        id: createParagraphId(documentId, pageNumber, paragraphIndex),
        documentId,
        pageNumber,
        paragraphIndex,
        text,
        sourceTextHash: await hashSourceText(text),
        pageBounds: { coordinateSystem: 'pdf-user-space', x, y, width: right - x, height: top - y },
        items: paragraphItems.map(({ right: _right, ...item }) => item),
      })
    }
    paragraphLines = []
  }

  for (const [lineIndex, line] of bodyLines.entries()) {
    const previousLine = paragraphLines.at(-1)
    if (previousLine) {
      const verticalGap = previousLine.baseline - line.baseline
      const typicalLineHeight = Math.max(previousLine.height, line.height)
      if (verticalGap > typicalLineHeight * 1.75
        || isIndentedParagraphStart(line, previousLine, lineIndex, bodyLeftEdge)) await flushParagraph()
    }
    paragraphLines.push(line)
  }
  await flushParagraph()

  return {
    pageNumber,
    items: items.map(({ right: _right, ...item }) => item),
    paragraphs,
    extractedAt: Date.now(),
  }
}

export function getPageNumberFromInput(value: string, pageCount: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const pageNumber = Number(value)
  return Number.isSafeInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pageCount
    ? pageNumber
    : null
}
