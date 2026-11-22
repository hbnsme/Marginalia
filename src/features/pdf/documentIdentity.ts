import type { DocumentId } from './pdfTypes'

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Hashes PDF bytes locally. No document data leaves the browser. */
export async function createDocumentId(bytes: Uint8Array): Promise<DocumentId> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return `sha256:${await sha256Hex(copy)}`
}

export async function hashSourceText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text))
}

export function createParagraphId(documentId: DocumentId, pageNumber: number, paragraphIndex: number) {
  return `${documentId}:page:${pageNumber}:paragraph:${paragraphIndex}`
}
