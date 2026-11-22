import type { NoteRecord, PdfParagraph } from './pdfTypes'

export type NoteDraftIdentity = Pick<PdfParagraph, 'documentId' | 'id' | 'sourceTextHash'>

export type NoteDraft = NoteDraftIdentity & { text: string }
export type NoteDraftState = Record<string, NoteDraft>

export function handleNoteInputChange(event: { currentTarget: { value: string } }, applyText: (text: string) => void) {
  // Read the event target synchronously; React clears currentTarget after dispatch.
  const text = event.currentTarget.value
  applyText(text)
}

export function getNoteDraftKey(identity: NoteDraftIdentity): string | null {
  if (!identity.documentId || !identity.id || !identity.sourceTextHash) return null
  return JSON.stringify([identity.documentId, identity.id, identity.sourceTextHash])
}

export function getMatchingNoteDraft(state: NoteDraftState, identity: NoteDraftIdentity): NoteDraft | undefined {
  const key = getNoteDraftKey(identity)
  if (!key) return undefined
  const draft = state[key]
  return draft
    && draft.documentId === identity.documentId
    && draft.id === identity.id
    && draft.sourceTextHash === identity.sourceTextHash
    ? draft
    : undefined
}

export function initializeNoteDraft(state: NoteDraftState, identity: NoteDraftIdentity, savedText = ''): NoteDraftState {
  if (!getNoteDraftKey(identity) || getMatchingNoteDraft(state, identity)) return state
  const key = getNoteDraftKey(identity)!
  return { ...state, [key]: { ...identity, text: savedText } }
}

export function updateNoteDraft(state: NoteDraftState, identity: NoteDraftIdentity, text: string): NoteDraftState {
  const key = getNoteDraftKey(identity)
  if (!key) return state
  return { ...state, [key]: { ...identity, text } }
}

export function removeNoteDraft(state: NoteDraftState, identity: NoteDraftIdentity): NoteDraftState {
  const key = getNoteDraftKey(identity)
  if (!key || !(key in state)) return state
  const next = { ...state }
  delete next[key]
  return next
}

export function restoreNoteDraftState(notes: readonly NoteRecord[]): NoteDraftState {
  return notes.reduce<NoteDraftState>((drafts, note) => {
    if (!note.sourceTextHash) return drafts
    const identity = { documentId: note.documentId, id: note.paragraphId, sourceTextHash: note.sourceTextHash }
    const key = getNoteDraftKey(identity)
    if (!key) return drafts
    return { ...drafts, [key]: { ...identity, text: note.text } }
  }, {})
}

export function getNoteDraftText(state: NoteDraftState, identity: NoteDraftIdentity, savedText = ''): string {
  return getMatchingNoteDraft(state, identity)?.text ?? savedText
}
