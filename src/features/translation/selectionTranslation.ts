export const MAX_SELECTION_TRANSLATION_LENGTH = 3000

export type CapturedTextSelection = {
  text: string
  paragraphId: string
  pageNumber: number
  bounds: DOMRect
}

export function normalizeSelectedText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function validateSelectionLength(text: string): 'empty' | 'too-long' | 'valid' {
  const normalized = normalizeSelectedText(text)
  if (!normalized) return 'empty'
  return normalized.length > MAX_SELECTION_TRANSLATION_LENGTH ? 'too-long' : 'valid'
}

export function captureParagraphSelection(selection: Selection | null, root: ParentNode): CapturedTextSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  const textNodes: Node[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node)
  const startIndex = textNodes.findIndex((node) => node === range.startContainer || node.contains(range.startContainer))
  const endIndex = textNodes.findIndex((node) => node === range.endContainer || node.contains(range.endContainer))
  if (startIndex < 0 || endIndex < 0) return null
  const startParagraph = textNodes[startIndex].parentElement?.closest<HTMLElement>('.extracted-paragraph-text')
  const endParagraph = textNodes[endIndex].parentElement?.closest<HTMLElement>('.extracted-paragraph-text')
  if (!startParagraph || startParagraph !== endParagraph || !root.contains(startParagraph)) return null
  const paragraph = startParagraph.closest<HTMLElement>('[data-paragraph-id][data-page-number]')
  const paragraphId = paragraph?.dataset.paragraphId
  const pageNumber = Number(paragraph?.dataset.pageNumber)
  const text = normalizeSelectedText(selection.toString())
  if (!paragraphId || !Number.isSafeInteger(pageNumber) || validateSelectionLength(text) !== 'valid') return null
  return { text, paragraphId, pageNumber, bounds: range.getBoundingClientRect() }
}
