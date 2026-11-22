import { describe, expect, it } from 'vitest'
import { isCurrentPdfImport } from './pdfImportLifecycle'

describe('PDF import operation identity', () => {
  it('allows only the latest async import result to become active', () => {
    expect(isCurrentPdfImport(4, 4)).toBe(true)
    expect(isCurrentPdfImport(3, 4)).toBe(false)
    expect(isCurrentPdfImport(5, 4)).toBe(false)
    expect(isCurrentPdfImport(Number.NaN, 4)).toBe(false)
  })
})
