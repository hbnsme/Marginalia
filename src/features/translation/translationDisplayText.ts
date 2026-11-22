const quotePairs = new Map([
  ['“', '”'],
  ['‘', '’'],
  ['《', '》'],
])

const closingQuotes = new Set(quotePairs.values())
const cjkPunctuation = /[\p{Script=Han}\u3001\u3002\u3008-\u3011\u3014-\u301F\u3030\u30FB\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/u
const chineseSentencePunctuation = new Set(['，', '。', '、', '！', '？', '；', '：'])

type QuotePair = { openIndex: number; closeIndex: number; open: string }
type OpenQuote = { character: string; index: number }

function isCjkPunctuationOrCharacter(character: string | undefined): boolean {
  return Boolean(character && cjkPunctuation.test(character))
}

function findQuotePairs(text: string): QuotePair[] {
  const stack: OpenQuote[] = []
  const pairs: QuotePair[] = []

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quotePairs.has(character)) {
      stack.push({ character, index })
      continue
    }
    if (!closingQuotes.has(character)) continue

    const open = stack.at(-1)
    if (open && quotePairs.get(open.character) === character) {
      stack.pop()
      pairs.push({ openIndex: open.index, closeIndex: index, open: open.character })
    }
  }

  return pairs
}

function markSpacesAfterQuotePunctuation(text: string, closeIndex: number, removed: Set<number>) {
  let cursor = closeIndex + 1
  while (cursor < text.length && text[cursor] === ' ') cursor += 1
  if (!chineseSentencePunctuation.has(text[cursor])) return

  const whitespaceRanges: Array<{ start: number; end: number }> = []
  while (cursor < text.length && chineseSentencePunctuation.has(text[cursor])) {
    cursor += 1
    const start = cursor
    while (cursor < text.length && text[cursor] === ' ') cursor += 1
    if (cursor > start) whitespaceRanges.push({ start, end: cursor })
  }

  if (isCjkPunctuationOrCharacter(text[cursor])) {
    for (const range of whitespaceRanges) {
      for (let index = range.start; index < range.end; index += 1) removed.add(index)
    }
  }
}

/**
 * Produces a conservative reading-only copy of Chinese translation text.
 * Stored translations, clipboard content, and exports must continue using the original string.
 */
export function formatTranslationDisplayText(text: string): string {
  const removed = new Set<number>()

  for (const pair of findQuotePairs(text)) {
    let first = pair.openIndex + 1
    while (first < pair.closeIndex && text[first] === ' ') first += 1
    let last = pair.closeIndex - 1
    while (last > pair.openIndex && text[last] === ' ') last -= 1

    // Only strip quote-edge spaces when both quoted edges are CJK characters or punctuation.
    // English phrases, numeric forms, mixed-language edges, and line breaks stay untouched.
    if (first <= last
      && isCjkPunctuationOrCharacter(text[first])
      && isCjkPunctuationOrCharacter(text[last])) {
      for (let index = pair.openIndex + 1; index < first; index += 1) removed.add(index)
      for (let index = last + 1; index < pair.closeIndex; index += 1) removed.add(index)
    }

    let before = pair.openIndex
    while (before > 0 && text[before - 1] === ' ') before -= 1
    if (before < pair.openIndex && isCjkPunctuationOrCharacter(text[before - 1])) {
      for (let index = before; index < pair.openIndex; index += 1) removed.add(index)
    }

    let after = pair.closeIndex + 1
    while (after < text.length && text[after] === ' ') after += 1
    if (after > pair.closeIndex + 1 && isCjkPunctuationOrCharacter(text[after])) {
      for (let index = pair.closeIndex + 1; index < after; index += 1) removed.add(index)
    }
    markSpacesAfterQuotePunctuation(text, pair.closeIndex, removed)
  }

  if (removed.size === 0) return text
  let formatted = ''
  for (let index = 0; index < text.length; index += 1) {
    if (!removed.has(index)) formatted += text[index]
  }
  return formatted
}
