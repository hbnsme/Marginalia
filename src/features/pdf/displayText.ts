import type { PdfParagraph } from './pdfTypes'

// High-confidence line-wrap pairs observed in the supplied academic PDF.
// Unknown hyphenated forms are preserved to avoid rewriting legitimate compounds.
const confirmedLineBreakJoins = new Set(['contrast|ing', 'de|ceptive'])
const japaneseLineCharacters = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3001-\u303F\uFF61-\uFF65]/u
const listLineStart = /^(?:[・●○■□◆◇▪•*\-]|[0-9０-９]+[.)．、])/u

export function prepareParagraphDisplayText(paragraph: Pick<PdfParagraph, 'text'>): string {
  const lines = paragraph.text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return paragraph.text
  let display = lines[0] ?? ''
  for (const nextLine of lines.slice(1)) {
    const match = /([\p{L}]+)-$/u.exec(display)
    const nextWord = /^([\p{Ll}]+)/u.exec(nextLine)?.[1]
    if (match && nextWord && confirmedLineBreakJoins.has(`${match[1].toLocaleLowerCase()}|${nextWord.toLocaleLowerCase()}`)) {
      display = `${display.slice(0, -match[0].length)}${match[1]}${nextWord}${nextLine.slice(nextWord.length)}`
    } else if (display.endsWith('\u00ad')) {
      display = `${display.slice(0, -1)}${nextLine}`
    } else {
      display = `${display} ${nextLine}`
    }
  }
  return display
}

/** OCR-only display copy: joins a single line break only when both edges are Japanese text. */
export function prepareOcrParagraphDisplayText(paragraph: Pick<PdfParagraph, 'text'>): string {
  const lines = paragraph.text.split(/\r?\n/u)
  if (lines.length < 2) return paragraph.text

  let display = lines[0] ?? ''
  for (let index = 1; index < lines.length; index += 1) {
    const currentLine = lines[index - 1] ?? ''
    const nextLine = lines[index] ?? ''
    const previousCharacter = [...currentLine].at(-1)
    const nextCharacter = [...nextLine][0]
    if (currentLine.length > 0
      && nextLine.length > 0
      && !listLineStart.test(nextLine)
      && japaneseLineCharacters.test(previousCharacter ?? '')
      && japaneseLineCharacters.test(nextCharacter ?? '')) {
      display += nextLine
    } else if (currentLine.length === 0 || nextLine.length === 0) {
      // Keep blank-line boundaries intact; only ordinary single line wraps are candidates.
      display += `\n${nextLine}`
    } else {
      display += ` ${nextLine}`
    }
  }
  return display
}
