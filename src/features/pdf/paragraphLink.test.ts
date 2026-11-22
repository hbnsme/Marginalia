import { describe, expect, it } from 'vitest'
import { findParagraphLinkTarget, shouldActivateParagraphLink } from './paragraphLink'

describe('paragraph link interaction guards', () => {
  it('activates only explicit clicks without selection or interactive controls', () => {
    expect(shouldActivateParagraphLink({ isTrustedClick: true, hasTextSelection: false, isInteractiveTarget: false })).toBe(true)
    expect(shouldActivateParagraphLink({ isTrustedClick: false, hasTextSelection: false, isInteractiveTarget: false })).toBe(false)
    expect(shouldActivateParagraphLink({ isTrustedClick: true, hasTextSelection: true, isInteractiveTarget: false })).toBe(false)
    expect(shouldActivateParagraphLink({ isTrustedClick: true, hasTextSelection: false, isInteractiveTarget: true })).toBe(false)
  })

  it('matches only the same paragraph ID and safely skips a missing target', () => {
    const source = { dataset: { paragraphId: 'p1' } }
    const translation = { dataset: { paragraphId: 'p2' } }
    expect(findParagraphLinkTarget([source, translation], 'p2')).toBe(translation)
    expect(findParagraphLinkTarget([source, translation], 'missing')).toBeNull()
  })
})
