import { describe, expect, it } from 'vitest'
import { formatTranslationDisplayText } from './translationDisplayText'

describe('formatTranslationDisplayText', () => {
  it('removes edge spaces inside Chinese curly quotes around Chinese text', () => {
    expect(formatTranslationDisplayText('“ 骗子 ”')).toBe('“骗子”')
  })

  it('joins Chinese text, paired quotes, and Chinese punctuation without changing the words', () => {
    expect(formatTranslationDisplayText('他被称为 “ 骗子 ” ，却仍然坚持自己的观点。'))
      .toBe('他被称为“骗子”，却仍然坚持自己的观点。')
  })

  it('removes edge spaces inside paired Chinese book-title marks', () => {
    expect(formatTranslationDisplayText('《 书名 》')).toBe('《书名》')
  })

  it('formats supported nested Chinese quotation marks', () => {
    expect(formatTranslationDisplayText('她称为 “ 外层 ‘ 内层 ’ 内容 ” ，然后继续。'))
      .toBe('她称为“外层‘内层’内容”，然后继续。')
  })

  it('leaves straight English quotes and meaningful English spaces unchanged', () => {
    expect(formatTranslationDisplayText('He called it " a useful phrase ".'))
      .toBe('He called it " a useful phrase ".')
    expect(formatTranslationDisplayText('他说 “ an English phrase ” ，然后继续。'))
      .toBe('他说“ an English phrase ”，然后继续。')
  })

  it('preserves numeric and mixed-language quote-edge spaces when their meaning is uncertain', () => {
    expect(formatTranslationDisplayText('年份 “ 2024 ” ，随后出现 PDF 文本。'))
      .toBe('年份“ 2024 ”，随后出现 PDF 文本。')
    expect(formatTranslationDisplayText('书名为 “ PDF 文献 ” ，正文继续。'))
      .toBe('书名为“ PDF 文献 ”，正文继续。')
    expect(formatTranslationDisplayText('数字 1 ， 2 保持原样。'))
      .toBe('数字 1 ， 2 保持原样。')
  })

  it('does not fold line breaks, paragraph boundaries, or ordinary spaces globally', () => {
    expect(formatTranslationDisplayText('这是一段 文字。\n\n这是 “ 引文 ” 。'))
      .toBe('这是一段 文字。\n\n这是“引文”。')
    expect(formatTranslationDisplayText('不属于引号的标点 ， 间距保持不变。'))
      .toBe('不属于引号的标点 ， 间距保持不变。')
  })

  it('returns a display copy without mutating the source record', () => {
    const savedRecord = { translatedText: '他说 “ 骗子 ” ，然后离开。' }
    const original = savedRecord.translatedText

    expect(formatTranslationDisplayText(savedRecord.translatedText)).toBe('他说“骗子”，然后离开。')
    expect(savedRecord.translatedText).toBe(original)
  })

  it('formats newly returned and restored translation values identically without changing either value', () => {
    const rawText = '称为 “ 骗子 ” ，后来又澄清。'
    const restoredRecord = { translatedText: rawText }
    const freshResult = { translatedText: rawText }

    expect(formatTranslationDisplayText(restoredRecord.translatedText))
      .toBe(formatTranslationDisplayText(freshResult.translatedText))
    expect(restoredRecord.translatedText).toBe(rawText)
    expect(freshResult.translatedText).toBe(rawText)
  })
})
