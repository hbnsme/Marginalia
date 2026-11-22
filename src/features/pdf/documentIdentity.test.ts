import { describe, expect, it } from 'vitest'
import { createDocumentId, createParagraphId, hashSourceText } from './documentIdentity'

describe('document and paragraph identity', () => {
  it('creates a stable local SHA-256 document ID for identical PDF bytes', async () => {
    const bytes = new TextEncoder().encode('same local pdf bytes')
    const first = await createDocumentId(bytes)
    const second = await createDocumentId(new Uint8Array(bytes))
    const other = await createDocumentId(new TextEncoder().encode('different pdf bytes'))
    expect(first).toMatch(/^sha256:[a-f\d]{64}$/)
    expect(second).toBe(first)
    expect(other).not.toBe(first)
  })

  it('uses document, page, and paragraph order in the ID independently of the text checksum', async () => {
    const documentId = await createDocumentId(new TextEncoder().encode('pdf'))
    const id = createParagraphId(documentId, 3, 2)
    expect(id).toBe(`${documentId}:page:3:paragraph:2`)
    expect(createParagraphId(documentId, 3, 3)).not.toBe(id)
    expect(createParagraphId(documentId, 4, 2)).not.toBe(id)
    expect(await hashSourceText('same paragraph')).toBe(await hashSourceText('same paragraph'))
    expect(await hashSourceText('changed paragraph')).not.toBe(await hashSourceText('same paragraph'))
    expect(id).not.toContain(await hashSourceText('same paragraph'))
  })
})
