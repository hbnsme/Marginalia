import { describe, expect, it } from 'vitest'
import type { DocumentId, NoteRecord } from './pdfTypes'
import {
  getMatchingNoteDraft,
  getNoteDraftKey,
  getNoteDraftText,
  handleNoteInputChange,
  initializeNoteDraft,
  restoreNoteDraftState,
  updateNoteDraft,
} from './noteDraftState'

const documentId = `sha256:${'a'.repeat(64)}` as DocumentId
const paragraphId = `${documentId}:page:77:paragraph:5`
const identityA = { documentId, id: paragraphId, sourceTextHash: 'hash-a' }
const identityB = { documentId, id: paragraphId, sourceTextHash: 'hash-b' }

function note(identity: typeof identityA, text: string): NoteRecord {
  return {
    id: `note:${identity.documentId}:${identity.id}:source:${identity.sourceTextHash}`,
    documentId: identity.documentId,
    paragraphId: identity.id,
    sourceTextHash: identity.sourceTextHash,
    pageNumber: 77,
    text,
    updatedAt: 1,
  }
}

describe('paragraph note draft identity', () => {
  it.each([
    ['ordinary keyboard input', 'A plain note'],
    ['multiline Chinese paste', '第一行中文\n第二行内容\n第三行。'],
  ])('captures %s before React clears the event target', (_kind, value) => {
    let deferredUpdate: (() => ReturnType<typeof updateNoteDraft>) | undefined
    const event: { currentTarget: { value: string } | null } = { currentTarget: { value } }
    handleNoteInputChange(event as { currentTarget: { value: string } }, (capturedText) => {
      deferredUpdate = () => updateNoteDraft({}, identityA, capturedText)
    })

    event.currentTarget = null
    expect(deferredUpdate?.()).toMatchObject({
      [getNoteDraftKey(identityA)!]: { ...identityA, text: value },
    })
  })

  it('keeps parallel notes for the same paragraph ID but different source hashes independent', () => {
    let drafts = restoreNoteDraftState([note(identityA, 'A original'), note(identityB, 'B original')])
    drafts = updateNoteDraft(drafts, identityA, 'A edited')

    expect(getNoteDraftText(drafts, identityA)).toBe('A edited')
    expect(getNoteDraftText(drafts, identityB)).toBe('B original')

    drafts = updateNoteDraft(drafts, identityB, 'B edited')
    expect(getNoteDraftText(drafts, identityA)).toBe('A edited')
    expect(getNoteDraftText(drafts, identityB)).toBe('B edited')
  })

  it('does not carry an unsaved draft when editing switches to another source identity', () => {
    let drafts = initializeNoteDraft({}, identityA)
    drafts = updateNoteDraft(drafts, identityA, 'Unsaved A')
    drafts = initializeNoteDraft(drafts, identityB, 'Saved B')

    expect(getNoteDraftText(drafts, identityB)).toBe('Saved B')
    expect(getNoteDraftText(drafts, identityA)).toBe('Unsaved A')
  })

  it('restores only hash-bearing drafts and requires exact document, paragraph, and hash identity', () => {
    const legacy = { ...note(identityA, 'Legacy text') }
    delete legacy.sourceTextHash
    const drafts = restoreNoteDraftState([note(identityA, 'A saved'), note(identityB, 'B saved'), legacy])

    expect(getMatchingNoteDraft(drafts, identityA)?.text).toBe('A saved')
    expect(getMatchingNoteDraft(drafts, identityB)?.text).toBe('B saved')
    expect(getMatchingNoteDraft(drafts, { ...identityA, sourceTextHash: '' })).toBeUndefined()
    expect(getMatchingNoteDraft(drafts, { ...identityA, documentId: `sha256:${'b'.repeat(64)}` as DocumentId })).toBeUndefined()
    expect(Object.values(drafts)).toHaveLength(2)
  })

  it('does not initialize a new paragraph from another note with a reused paragraph ID', () => {
    const drafts = restoreNoteDraftState([note(identityA, 'Historical A')])
    const newIdentity = { ...identityA, sourceTextHash: 'hash-new' }
    const initialized = initializeNoteDraft(drafts, newIdentity)

    expect(getNoteDraftText(initialized, newIdentity)).toBe('')
    expect(getNoteDraftText(initialized, identityA)).toBe('Historical A')
  })

  it('uses the matching saved note when opening the editor and preserves same-identity edits', () => {
    const savedText = 'Saved same identity'
    let drafts = initializeNoteDraft({}, identityA, savedText)
    expect(getNoteDraftText(drafts, identityA, 'fallback')).toBe(savedText)
    drafts = updateNoteDraft(drafts, identityA, 'Updated in editor')
    expect(getNoteDraftText(drafts, identityA, savedText)).toBe('Updated in editor')
    expect(getNoteDraftKey(identityA)).not.toBe(getNoteDraftKey(identityB))
  })
})
