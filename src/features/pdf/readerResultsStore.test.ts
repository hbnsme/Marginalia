import { beforeEach, describe, expect, it } from 'vitest'
import type { DocumentId, NoteRecord, TranslationRecord } from './pdfTypes'
import { getTranslationAssociationStatus, IndexedDbReaderResultsStore, noteRecordMatchesParagraph, ReaderResultsStorageError, serializeTranslationsForExport, translationRecordMatchesParagraph, versionedNoteRecordId, versionedTranslationRecordId } from './readerResultsStore'
import { TRANSLATION_PREPROCESSING_VERSION } from '../translation/translationText'
import { getNoteAssociationStatus } from './noteAssociation'

const documentOne = `sha256:${'1'.repeat(64)}` as DocumentId
const documentTwo = `sha256:${'2'.repeat(64)}` as DocumentId
const paragraphOne = `${documentOne}:page:3:paragraph:2`
const paragraphTwo = `${documentTwo}:page:3:paragraph:2`

let database: TestDatabase
let store: IndexedDbReaderResultsStore

describe('IndexedDbReaderResultsStore', () => {
  beforeEach(() => {
    database = new TestDatabase()
    store = new IndexedDbReaderResultsStore(database.factory)
  })

  it('saves a successful translation and restores it for the same document', async () => {
    const translation = makeTranslation(documentOne, paragraphOne, 'First saved translation.')
    expect(translation.id).toBe(`${paragraphOne}:translation:zh-CN:en:source:source-hash:preprocess:${TRANSLATION_PREPROCESSING_VERSION}`)
    await store.saveTranslation(translation)

    const restored = await store.loadDocument(documentOne)
    expect(restored.translations).toHaveLength(1)
    expect(restored.translations[0]).toMatchObject(translation)
    expect(restored.notes).toEqual([])
  })

  it('updates an existing translation on retranslation instead of adding a duplicate', async () => {
    const original = makeTranslation(documentOne, paragraphOne, 'First translation.')
    await store.saveTranslation(original)
    await store.saveTranslation({ ...original, translatedText: 'Updated translation.', createdAt: 2 })

    const restored = await store.loadDocument(documentOne)
    expect(restored.translations).toHaveLength(1)
    expect(restored.translations[0]?.translatedText).toBe('Updated translation.')
  })

  it('keeps a previously saved translation intact when a replacement cannot be written', async () => {
    const saved = makeTranslation(documentOne, paragraphOne, 'Previously saved translation.')
    await store.saveTranslation(saved)
    database.failNextWrite = true

    await expect(store.saveTranslation({ ...saved, translatedText: 'New translation.' })).rejects.toBeInstanceOf(ReaderResultsStorageError)
    const restored = await store.loadDocument(documentOne)
    expect(restored.translations[0]?.translatedText).toBe('Previously saved translation.')
  })

  it('adds, edits, deletes, and restores paragraph notes', async () => {
    const note = makeNote(documentOne, paragraphOne, 'First note.')
    await store.saveNote(note)
    expect((await store.loadDocument(documentOne)).notes[0]?.text).toBe('First note.')

    await store.saveNote({ ...note, text: 'Edited note.', updatedAt: 2 })
    expect((await store.loadDocument(documentOne)).notes).toHaveLength(1)
    expect((await store.loadDocument(documentOne)).notes[0]?.text).toBe('Edited note.')

    await store.deleteNote(documentOne, note.id)
    expect((await store.loadDocument(documentOne)).notes).toEqual([])
  })

  it('isolates records for different PDFs even when their paragraph order and text match', async () => {
    await store.saveTranslation(makeTranslation(documentOne, paragraphOne, 'Same text.'))
    await store.saveTranslation(makeTranslation(documentTwo, paragraphTwo, 'Same text.'))
    await store.saveNote(makeNote(documentOne, paragraphOne, 'Document one note.'))
    await store.saveNote(makeNote(documentTwo, paragraphTwo, 'Document two note.'))

    expect((await store.loadDocument(documentOne)).translations).toHaveLength(1)
    expect((await store.loadDocument(documentOne)).notes[0]?.text).toBe('Document one note.')
    expect((await store.loadDocument(documentTwo)).translations).toHaveLength(1)
    expect((await store.loadDocument(documentTwo)).notes[0]?.text).toBe('Document two note.')
  })

  it('rejects storage access cleanly when IndexedDB is unavailable', async () => {
    const unavailable = new IndexedDbReaderResultsStore(undefined)
    await expect(unavailable.loadDocument(documentOne)).rejects.toMatchObject({
      name: 'ReaderResultsStorageError',
      message: '此浏览器环境不支持 IndexedDB。',
    })
  })

  it('skips incompatible or incomplete records without failing restoration', async () => {
    await store.saveTranslation(makeTranslation(documentOne, paragraphOne, 'Valid translation.'))
    database.records.get('translations')!.set('legacy-record', {
      id: 'legacy-record', documentId: documentOne, paragraphId: paragraphOne,
      sourceLanguage: 'en', targetLanguage: 'zh-CN', translatedText: 'Old format.',
    })

    const restored = await store.loadDocument(documentOne)
    expect(restored.translations).toHaveLength(1)
    expect(restored.translations[0]?.translatedText).toBe('Valid translation.')
    expect(restored.skippedRecords).toBe(1)
  })

  it('restores pre-version translations as stale while retaining notes unchanged', async () => {
    const current = makeTranslation(documentOne, paragraphOne, 'Previously saved translation.')
    const legacy = { ...current, id: `${paragraphOne}:translation:zh-CN:en`, preprocessingVersion: undefined }
    delete (legacy as Partial<TranslationRecord>).preprocessingVersion
    database.records.set('translations', new Map([[legacy.id, { ...legacy, schemaVersion: 1 }]]))
    database.records.set('notes', new Map())
    await store.saveNote(makeNote(documentOne, paragraphOne, 'Keep this note.'))

    const restored = await store.loadDocument(documentOne)
    expect(restored.translations[0]).toMatchObject({ translatedText: legacy.translatedText })
    expect(restored.translations[0]?.preprocessingVersion).toBeUndefined()
    expect(restored.translations[0]?.preprocessingVersion).not.toBe(TRANSLATION_PREPROCESSING_VERSION)
    expect(restored.notes).toMatchObject([{ text: 'Keep this note.', paragraphId: paragraphOne }])
  })

  it('reads and preserves a legacy translation ID without auto-matching its missing hash', async () => {
    const legacyId = `${paragraphOne}:translation:zh-CN:en`
    database.records.set('translations', new Map([[legacyId, {
      id: legacyId, documentId: documentOne, paragraphId: paragraphOne,
      sourceLanguage: 'en', targetLanguage: 'zh-CN', translatedText: 'Legacy translation.', createdAt: 1, schemaVersion: 1,
    }]]))
    database.records.set('notes', new Map())
    const restored = await store.loadDocument(documentOne)
    expect(restored.translations[0]).toMatchObject({ id: legacyId, translatedText: 'Legacy translation.' })
    expect(restored.translations[0]?.sourceTextHash).toBeUndefined()
    expect(restored.translations[0]?.id).toBe(legacyId)
    expect(translationRecordMatchesParagraph(restored.translations[0]!, {
      id: paragraphOne, documentId: documentOne, pageNumber: 3, paragraphIndex: 2,
      text: 'Current text.', sourceTextHash: 'source-hash', pageBounds: null, items: [],
    }, TRANSLATION_PREPROCESSING_VERSION)).toBe(false)
  })

  it('keeps a newly saved record separate from an old-format record with the same paragraph and languages', async () => {
    const legacyId = `${paragraphOne}:translation:zh-CN:en`
    const legacy = {
      id: legacyId, documentId: documentOne, paragraphId: paragraphOne,
      sourceLanguage: 'en' as const, targetLanguage: 'zh-CN' as const, translatedText: 'Historical translation.', createdAt: 1, schemaVersion: 1,
    }
    database.records.set('translations', new Map([[legacyId, legacy]]))
    database.records.set('notes', new Map())

    const current = makeTranslation(documentOne, paragraphOne, 'Current translation.')
    await store.saveTranslation(current)

    const restored = await store.loadDocument(documentOne)
    expect(restored.translations).toHaveLength(2)
    expect(restored.translations.map(({ id, translatedText }) => ({ id, translatedText }))).toEqual(expect.arrayContaining([
      { id: legacyId, translatedText: 'Historical translation.' },
      { id: current.id, translatedText: 'Current translation.' },
    ]))
    expect(JSON.parse(serializeTranslationsForExport(restored.translations))).toHaveLength(2)
  })

  it('rejects a negative preprocessing version before it can create an unreadable record', async () => {
    const translation = makeTranslation(documentOne, paragraphOne, 'Invalid version.')
    const invalid = {
      ...translation,
      preprocessingVersion: -1,
      id: versionedTranslationRecordId(paragraphOne, 'zh-CN', 'en', 'source-hash', -1),
    }
    await expect(store.saveTranslation(invalid)).rejects.toBeInstanceOf(ReaderResultsStorageError)
  })

  it('preserves a legacy translation with a source hash but no current preprocessing version', async () => {
    const legacyId = `${paragraphOne}:translation:zh-CN:en`
    const legacy = {
      id: legacyId, documentId: documentOne, paragraphId: paragraphOne, sourceTextHash: 'source-hash',
      sourceLanguage: 'en' as const, targetLanguage: 'zh-CN' as const, translatedText: 'Legacy versioned text.', createdAt: 5, schemaVersion: 1,
    }
    database.records.set('translations', new Map([[legacyId, legacy]]))
    database.records.set('notes', new Map())
    const restored = await store.loadDocument(documentOne)
    expect(restored.translations[0]).toMatchObject({ id: legacyId, sourceTextHash: 'source-hash', translatedText: 'Legacy versioned text.' })
    expect(restored.translations[0]?.preprocessingVersion).toBeUndefined()
  })

  it('stores different source hashes and preprocessing versions as independent translation records', async () => {
    const first = makeTranslation(documentOne, paragraphOne, 'Historical translation.')
    const differentHash = { ...first, id: versionedTranslationRecordId(paragraphOne, 'zh-CN', 'en', 'other-hash', 1), sourceTextHash: 'other-hash', translatedText: 'Other source.' }
    const differentVersion = { ...first, id: versionedTranslationRecordId(paragraphOne, 'zh-CN', 'en', 'source-hash', 2), preprocessingVersion: 2, translatedText: 'Other preprocessing.' }
    await store.saveTranslation(first)
    await store.saveTranslation(differentHash)
    await store.saveTranslation(differentVersion)
    const restored = await store.loadDocument(documentOne)
    expect(restored.translations).toHaveLength(3)
    expect(restored.translations.map((record) => record.translatedText)).toEqual(expect.arrayContaining([
      'Historical translation.', 'Other source.', 'Other preprocessing.',
    ]))
  })

  it('does not restore a translation when the paragraph hash or preprocessing version differs', () => {
    const translation = makeTranslation(documentOne, paragraphOne, 'Saved translation.')
    const paragraph = {
      id: paragraphOne, documentId: documentOne, pageNumber: 3, paragraphIndex: 2,
      text: 'Current paragraph.', sourceTextHash: 'source-hash', pageBounds: null, items: [],
    }
    expect(translationRecordMatchesParagraph(translation, { ...paragraph, sourceTextHash: 'different-hash' }, TRANSLATION_PREPROCESSING_VERSION)).toBe(false)
    expect(translationRecordMatchesParagraph(translation, paragraph, TRANSLATION_PREPROCESSING_VERSION + 1)).toBe(false)
  })

  it('classifies all-translation records conservatively and exports their original metadata', async () => {
    const legacyId = `${paragraphOne}:translation:zh-CN:en`
    const legacy = {
      id: legacyId, documentId: documentOne, paragraphId: paragraphOne,
      sourceLanguage: 'en' as const, targetLanguage: 'zh-CN' as const, translatedText: 'Old translation.', createdAt: 1, schemaVersion: 1,
    }
    database.records.set('translations', new Map([[legacyId, legacy]]))
    database.records.set('notes', new Map())
    const { translations } = await store.loadDocument(documentOne)
    const paragraph = {
      id: paragraphOne, documentId: documentOne, pageNumber: 3, paragraphIndex: 2,
      text: 'Current text.', sourceTextHash: 'source-hash', pageBounds: null, items: [],
    }
    expect(getTranslationAssociationStatus(translations[0]!, new Set(), new Map(), TRANSLATION_PREPROCESSING_VERSION)).toBe('review')
    expect(getTranslationAssociationStatus(translations[0]!, new Set([3]), new Map([[paragraphOne, paragraph]]), TRANSLATION_PREPROCESSING_VERSION)).toBe('review')
    const oldPreprocessing = { ...makeTranslation(documentOne, paragraphOne, 'Previous preprocessing.') , preprocessingVersion: TRANSLATION_PREPROCESSING_VERSION - 1 }
    expect(getTranslationAssociationStatus(oldPreprocessing, new Set([3]), new Map([[paragraphOne, paragraph]]), TRANSLATION_PREPROCESSING_VERSION)).toBe('review')
    expect(JSON.parse(serializeTranslationsForExport(translations))).toEqual([legacy])
  })

  it('marks a translation for an unloaded page as unverified, not missing', () => {
    const translation = makeTranslation(documentOne, paragraphOne, 'Saved translation.')
    expect(getTranslationAssociationStatus(translation, new Set(), new Map(), TRANSLATION_PREPROCESSING_VERSION)).toBe('unverified')
  })

  it('matches a note only to the exact document, paragraph, and extracted source text', () => {
    const note = makeNote(documentOne, paragraphOne, 'Note text.')
    const paragraph = {
      id: paragraphOne, documentId: documentOne, pageNumber: 3, paragraphIndex: 2,
      text: 'Original paragraph.', sourceTextHash: 'source-hash', pageBounds: null, items: [],
    }
    expect(noteRecordMatchesParagraph(note, paragraph)).toBe(true)
    expect(noteRecordMatchesParagraph(note, { ...paragraph, sourceTextHash: 'changed-source' })).toBe(false)
    expect(noteRecordMatchesParagraph(note, { ...paragraph, id: paragraphTwo, documentId: documentTwo })).toBe(false)
    expect(noteRecordMatchesParagraph({ ...note, sourceTextHash: '' }, paragraph)).toBe(false)
  })

  it('keeps same paragraph ID notes with different source hashes as separate records', async () => {
    const oldText = makeNote(documentOne, paragraphOne, 'Original note.')
    const newText = { ...oldText, id: versionedNoteRecordId(documentOne, paragraphOne, 'new-source-hash'), sourceTextHash: 'new-source-hash', text: 'Note for revised paragraph.' }
    await store.saveNote(oldText)
    await store.saveNote(newText)
    const loaded = await store.loadDocument(documentOne)
    expect(loaded.notes).toHaveLength(2)
    expect(loaded.notes.map((note) => note.text)).toContain('Original note.')
    expect(loaded.notes.map((note) => note.text)).toContain('Note for revised paragraph.')
  })

  it('preserves an earlier note format that did not store a source hash', async () => {
    const note = makeNote(documentOne, paragraphOne, 'Existing note without source checksum.')
    await store.saveNote(note)
    const storedNotes = database.records.get('notes')!
    const persistedNote = [...storedNotes.values()][0]!
    delete persistedNote.sourceTextHash
    storedNotes.set(String(persistedNote.id), persistedNote)

    const restored = await store.loadDocument(documentOne)
    expect(restored.notes).toHaveLength(1)
    expect(restored.notes[0]?.text).toBe('Existing note without source checksum.')
    expect(restored.notes[0]?.sourceTextHash).toBeUndefined()
    expect(restored.notes[0]?.id).toBe(note.id)
  })

  it('classifies all note association states without treating unloaded pages as missing', () => {
    const paragraph = { id: paragraphOne, documentId: documentOne, pageNumber: 3, paragraphIndex: 2, text: 'Text', sourceTextHash: 'hash-a', pageBounds: null, items: [] }
    const linked = { ...makeNote(documentOne, paragraphOne, 'Linked'), sourceTextHash: 'hash-a' }
    const changed = { ...linked, sourceTextHash: 'hash-b' }
    const missingHash = { ...linked, sourceTextHash: undefined }
    const loadedPage = new Set([3])
    const loadedParagraphs = new Map([[paragraphOne, paragraph]])
    expect(getNoteAssociationStatus(linked, loadedPage, loadedParagraphs)).toBe('linked')
    expect(getNoteAssociationStatus(changed, loadedPage, loadedParagraphs)).toBe('review')
    expect(getNoteAssociationStatus({ ...linked, paragraphId: `${documentOne}:page:3:paragraph:99` }, loadedPage, loadedParagraphs)).toBe('review')
    expect(getNoteAssociationStatus(missingHash, new Set(), new Map())).toBe('review')
    expect(getNoteAssociationStatus(changed, new Set(), new Map())).toBe('unverified')
  })
})

function makeTranslation(documentId: DocumentId, paragraphId: string, translatedText: string): TranslationRecord {
  const sourceTextHash = 'source-hash'
  const preprocessingVersion = TRANSLATION_PREPROCESSING_VERSION
  return {
    id: versionedTranslationRecordId(paragraphId, 'zh-CN', 'en', sourceTextHash, preprocessingVersion),
    documentId,
    paragraphId,
    sourceTextHash,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    translatedText,
    createdAt: 1,
    preprocessingVersion,
  }
}

function makeNote(documentId: DocumentId, paragraphId: string, text: string): NoteRecord {
  return { id: `note:${documentId}:${paragraphId}`, documentId, paragraphId, sourceTextHash: 'source-hash', pageNumber: 3, text, updatedAt: 1 }
}

type FakeRequest<T> = IDBRequest<T> & { result: T; onsuccess: ((event: Event) => void) | null; onerror: ((event: Event) => void) | null }

class TestDatabase {
  readonly records = new Map<string, Map<string, Record<string, unknown>>>()
  failNextWrite = false
  readonly factory: IDBFactory

  constructor() {
    this.factory = { open: () => this.open() } as unknown as IDBFactory
  }

  private open(): IDBOpenDBRequest {
    const request = { result: undefined, transaction: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null } as unknown as IDBOpenDBRequest
    const db = new TestDatabaseHandle(this)
    const needsUpgrade = this.records.size === 0
    queueMicrotask(() => {
      Object.defineProperty(request, 'result', { configurable: true, value: db })
      Object.defineProperty(request, 'transaction', { configurable: true, value: new TestTransaction(this, []) })
      if (needsUpgrade) request.onupgradeneeded?.(new Event('upgradeneeded'))
      queueMicrotask(() => request.onsuccess?.(new Event('success')))
    })
    return request
  }
}

class TestDatabaseHandle {
  readonly objectStoreNames = { contains: (name: string) => this.owner.records.has(name) } as DOMStringList
  onversionchange: ((event: Event) => void) | null = null
  constructor(private readonly owner: TestDatabase) {}
  createObjectStore(name: string): IDBObjectStore {
    this.owner.records.set(name, new Map())
    return new TestObjectStore(this.owner, name, new TestTransaction(this.owner, [name])) as unknown as IDBObjectStore
  }
  transaction(storeNames: string | string[]): IDBTransaction {
    return new TestTransaction(this.owner, Array.isArray(storeNames) ? storeNames : [storeNames]) as unknown as IDBTransaction
  }
  close() {}
}

class TestTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  error: DOMException | null = null
  private pending = 0

  constructor(private readonly owner: TestDatabase, private readonly names: string[]) {}
  objectStore(name: string): IDBObjectStore {
    if (!this.names.includes(name)) throw new Error(`Store ${name} is not in this transaction.`)
    return new TestObjectStore(this.owner, name, this) as unknown as IDBObjectStore
  }
  schedule(operation: () => void) {
    this.pending += 1
    queueMicrotask(() => {
      try { operation() } catch (error) {
        this.error = error instanceof DOMException ? error : new DOMException(String(error))
        this.onerror?.(new Event('error'))
      }
      this.pending -= 1
      if (this.pending === 0) queueMicrotask(() => this.oncomplete?.(new Event('complete')))
    })
  }
}

class TestObjectStore {
  readonly indexNames = { contains: (name: string) => name === 'documentId' } as DOMStringList
  constructor(private readonly owner: TestDatabase, private readonly name: string, private readonly transaction: TestTransaction) {}
  createIndex() { return {} as IDBIndex }
  index(name: string): IDBIndex {
    if (name !== 'documentId') throw new Error(`Unknown index ${name}.`)
    return new TestIndex(this.owner, this.name, this.transaction) as unknown as IDBIndex
  }
  put(value: Record<string, unknown>) {
    const request = makeRequest(undefined)
    this.transaction.schedule(() => {
      if (this.owner.failNextWrite) {
        this.owner.failNextWrite = false
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      this.owner.records.get(this.name)!.set(String(value.id), { ...value })
      setRequestResult(request, value.id)
    })
    return request as IDBRequest<IDBValidKey>
  }
  delete(key: IDBValidKey) {
    const request = makeRequest(undefined)
    this.transaction.schedule(() => {
      this.owner.records.get(this.name)!.delete(String(key))
      setRequestResult(request, undefined)
    })
    return request as IDBRequest<undefined>
  }
}

class TestIndex {
  constructor(private readonly owner: TestDatabase, private readonly name: string, private readonly transaction: TestTransaction) {}
  getAll(documentId: IDBValidKey) {
    const request = makeRequest([] as Record<string, unknown>[])
    this.transaction.schedule(() => {
      const values = [...this.owner.records.get(this.name)!.values()].filter((record) => record.documentId === documentId)
      setRequestResult(request, values)
    })
    return request as IDBRequest<Record<string, unknown>[]>
  }
}

function makeRequest<T>(result: T): FakeRequest<T> {
  return { result, onsuccess: null, onerror: null } as unknown as FakeRequest<T>
}

function setRequestResult<T>(request: FakeRequest<T>, result: T) {
  Object.defineProperty(request, 'result', { configurable: true, value: result })
  request.onsuccess?.(new Event('success'))
}
