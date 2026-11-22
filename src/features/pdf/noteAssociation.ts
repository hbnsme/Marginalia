import type { NoteRecord, PdfParagraph } from './pdfTypes'

export type NoteAssociationStatus = 'linked' | 'review' | 'unverified'

export function getNoteAssociationStatus(
  note: NoteRecord,
  loadedPages: ReadonlySet<number>,
  paragraphsById: ReadonlyMap<string, PdfParagraph>,
): NoteAssociationStatus {
  if (!note.sourceTextHash) return 'review'
  if (!loadedPages.has(note.pageNumber)) return 'unverified'
  const paragraph = paragraphsById.get(note.paragraphId)
  return paragraph
    && paragraph.documentId === note.documentId
    && paragraph.id === note.paragraphId
    && Boolean(paragraph.sourceTextHash)
    && paragraph.sourceTextHash === note.sourceTextHash
    ? 'linked'
    : 'review'
}
