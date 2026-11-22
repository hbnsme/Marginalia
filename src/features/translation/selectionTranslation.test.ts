import { describe, expect, it } from 'vitest'
import { normalizeSelectedText, validateSelectionLength } from './selectionTranslation'

describe('selection translation input', () => {
  it.each([
    ['single word', 'affect', 'affect'],
    ['term', 'ugly feeling', 'ugly feeling'],
    ['sentence', 'A sentence.', 'A sentence.'],
    ['multiple text nodes and lines', 'across\n text nodes', 'across text nodes'],
  ])('normalizes %s without expanding the selection', (_label, input, expected) => {
    expect(normalizeSelectedText(input)).toBe(expected)
    expect(validateSelectionLength(input)).toBe('valid')
  })

  it('rejects whitespace and over-limit text using UTF-16 length', () => {
    expect(validateSelectionLength(' \n\t ')).toBe('empty')
    expect(validateSelectionLength('a'.repeat(3000))).toBe('valid')
    expect(validateSelectionLength('a'.repeat(3001))).toBe('too-long')
  })
})
