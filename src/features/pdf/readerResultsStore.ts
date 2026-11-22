import type { DocumentId, NoteRecord, PdfParagraph, TranslationRecord } from './pdfTypes'

const DATABASE_NAME = 'marginalia-reader-results'
const DATABASE_VERSION = 1
const TRANSLATIONS_STORE = 'translations'
const NOTES_STORE = 'notes'
const RECORD_SCHEMA_VERSION = 1

export type LoadedReaderResults = {
  translations: TranslationRecord[]
  notes: NoteRecord[]
  skippedRecords: number
}

export interface ReaderResultsStore {
  loadDocument(documentId: DocumentId): Promise<LoadedReaderResults>
  saveTranslation(record: TranslationRecord): Promise<void>
  saveNote(record: NoteRecord): Promise<void>
  deleteNote(documentId: DocumentId, noteId: string): Promise<void>
}

export function versionedTranslationRecordId(paragraphId: string, targetLanguage: string, sourceLanguage: string, sourceTextHash: string, preprocessingVersion: number) {
  return `${paragraphId}:translation:${targetLanguage}:${sourceLanguage}:source:${sourceTextHash}:preprocess:${preprocessingVersion}`
}

export class ReaderResultsStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReaderResultsStorageError'
  }
}

/** Stores only translations and notes; PDF bytes, page images, and OCR images stay out of IndexedDB. */
export class IndexedDbReaderResultsStore implements ReaderResultsStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory | undefined = getIndexedDbFactory()) {}

  async loadDocument(documentId: DocumentId): Promise<LoadedReaderResults> {
    const database = await this.openDatabase()
    const transaction = database.transaction([TRANSLATIONS_STORE, NOTES_STORE], 'readonly')
    const done = transactionDone(transaction)
    const translationRequest = transaction.objectStore(TRANSLATIONS_STORE).index('documentId').getAll(documentId)
    const noteRequest = transaction.objectStore(NOTES_STORE).index('documentId').getAll(documentId)
    try {
      const [rawTranslations, rawNotes] = await Promise.all([requestResult(translationRequest), requestResult(noteRequest)])
      await done
      const validTranslations: TranslationRecord[] = []
      const validNotes: NoteRecord[] = []
      let skippedRecords = 0
      for (const record of rawTranslations) {
        if (isStoredTranslation(record, documentId)) validTranslations.push(record)
        else skippedRecords += 1
      }
      for (const record of rawNotes) {
        if (isStoredNote(record, documentId)) {
          validNotes.push(record)
        }
        else skippedRecords += 1
      }
      return { translations: validTranslations, notes: validNotes, skippedRecords }
    } catch (error) {
      await done.catch(() => undefined)
      throw asStorageError('无法读取本地阅读成果。', error)
    }
  }

  async saveTranslation(record: TranslationRecord): Promise<void> {
    assertTranslationBelongsToDocument(record)
    await this.write(TRANSLATIONS_STORE, { ...record, schemaVersion: RECORD_SCHEMA_VERSION })
  }

  async saveNote(record: NoteRecord): Promise<void> {
    assertNoteBelongsToDocument(record)
    await this.write(NOTES_STORE, { ...record, schemaVersion: RECORD_SCHEMA_VERSION })
  }

  async deleteNote(documentId: DocumentId, noteId: string): Promise<void> {
    if (!noteId.startsWith(`note:${documentId}:`)) {
      throw new ReaderResultsStorageError('批注与当前文档不匹配。')
    }
    const database = await this.openDatabase()
    const transaction = database.transaction(NOTES_STORE, 'readwrite')
    const done = transactionDone(transaction)
    try {
      transaction.objectStore(NOTES_STORE).delete(noteId)
      await done
    } catch (error) {
      throw asStorageError('无法删除本地批注。', error)
    }
  }

  private async write(storeName: string, value: IDBValidRecord): Promise<void> {
    const database = await this.openDatabase()
    const transaction = database.transaction(storeName, 'readwrite')
    const done = transactionDone(transaction)
    try {
      transaction.objectStore(storeName).put(value)
      await done
    } catch (error) {
      throw asStorageError('无法保存本地阅读成果。', error)
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new ReaderResultsStorageError('此浏览器环境不支持 IndexedDB。'))
    if (this.databasePromise) return this.databasePromise

    const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        const translations = database.objectStoreNames.contains(TRANSLATIONS_STORE)
          ? request.transaction!.objectStore(TRANSLATIONS_STORE)
          : database.createObjectStore(TRANSLATIONS_STORE, { keyPath: 'id' })
        if (!translations.indexNames.contains('documentId')) translations.createIndex('documentId', 'documentId')

        const notes = database.objectStoreNames.contains(NOTES_STORE)
          ? request.transaction!.objectStore(NOTES_STORE)
          : database.createObjectStore(NOTES_STORE, { keyPath: 'id' })
        if (!notes.indexNames.contains('documentId')) notes.createIndex('documentId', 'documentId')
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          this.databasePromise = null
        }
        resolve(request.result)
      }
      request.onerror = () => reject(asStorageError('无法打开本地阅读成果数据库。', request.error))
      request.onblocked = () => reject(new ReaderResultsStorageError('本地阅读成果数据库升级被其他标签页阻止。'))
    })
    const databasePromise = opening.catch((error: unknown) => {
      this.databasePromise = null
      throw error instanceof ReaderResultsStorageError ? error : asStorageError('无法打开本地阅读成果数据库。', error)
    })
    this.databasePromise = databasePromise
    return databasePromise
  }
}

export const readerResultsStore: ReaderResultsStore = new IndexedDbReaderResultsStore()

export function noteRecordId(documentId: DocumentId, paragraphId: string) {
  return `note:${documentId}:${paragraphId}`
}

export function versionedNoteRecordId(documentId: DocumentId, paragraphId: string, sourceTextHash: string) {
  return `${noteRecordId(documentId, paragraphId)}:source:${sourceTextHash}`
}

export function paragraphBelongsToDocument(paragraph: Pick<PdfParagraph, 'id' | 'documentId'>) {
  return getParagraphPageNumber(paragraph.documentId, paragraph.id) !== null
}

export function noteRecordMatchesParagraph(note: NoteRecord, paragraph: PdfParagraph) {
  return note.documentId === paragraph.documentId
    && note.paragraphId === paragraph.id
    && Boolean(note.sourceTextHash)
    && note.sourceTextHash === paragraph.sourceTextHash
}

export type TranslationAssociationStatus = 'linked' | 'review' | 'unverified'

export function translationRecordMatchesParagraph(record: TranslationRecord, paragraph: PdfParagraph, currentPreprocessingVersion: number) {
  return record.documentId === paragraph.documentId
    && record.paragraphId === paragraph.id
    && Boolean(record.sourceTextHash)
    && record.sourceTextHash === paragraph.sourceTextHash
    && record.preprocessingVersion === currentPreprocessingVersion
}

export function getTranslationAssociationStatus(
  record: TranslationRecord,
  loadedPages: ReadonlySet<number>,
  paragraphsById: ReadonlyMap<string, PdfParagraph>,
  currentPreprocessingVersion: number,
): TranslationAssociationStatus {
  const pageNumber = getTranslationPageNumber(record.documentId, record.paragraphId)
  if (!record.sourceTextHash) return 'review'
  if (pageNumber === null || !loadedPages.has(pageNumber)) return 'unverified'
  const paragraph = paragraphsById.get(record.paragraphId)
  return paragraph && translationRecordMatchesParagraph(record, paragraph, currentPreprocessingVersion) ? 'linked' : 'review'
}

export function getTranslationPageNumber(documentId: DocumentId, paragraphId: string) {
  return getParagraphPageNumber(documentId, paragraphId)
}

export function serializeTranslationsForExport(records: readonly TranslationRecord[]) {
  return JSON.stringify(records, null, 2)
}

function getIndexedDbFactory(): IDBFactory | undefined {
  return typeof indexedDB === 'undefined' ? undefined : indexedDB
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

function isStoredTranslation(value: unknown, documentId: DocumentId): value is TranslationRecord & { preprocessingVersion?: number; sourceTextHash?: string; schemaVersion: number } {
  if (!isRecord(value)) return false
  const pageNumber = typeof value.paragraphId === 'string' ? getParagraphPageNumber(documentId, value.paragraphId) : null
  return value.schemaVersion === RECORD_SCHEMA_VERSION
    && value.documentId === documentId
    && typeof value.id === 'string'
    && typeof value.paragraphId === 'string'
    && pageNumber !== null
    && isSourceLanguage(value.sourceLanguage)
    && value.targetLanguage === 'zh-CN'
    && (value.id === translationRecordId(value.paragraphId, 'zh-CN', value.sourceLanguage)
      || (typeof value.sourceTextHash === 'string' && Number.isSafeInteger(value.preprocessingVersion)
        && value.id === versionedTranslationRecordId(value.paragraphId, 'zh-CN', value.sourceLanguage, value.sourceTextHash, value.preprocessingVersion as number)))
    && (value.sourceTextHash === undefined || typeof value.sourceTextHash === 'string')
    && typeof value.translatedText === 'string'
    && value.translatedText.trim().length > 0
    && (value.preprocessingVersion === undefined || (typeof value.preprocessingVersion === 'number' && Number.isSafeInteger(value.preprocessingVersion) && value.preprocessingVersion >= 0))
    && (value.translationSource === undefined || value.translationSource === 'proxy-cache' || value.translationSource === 'upstream')
    && typeof value.createdAt === 'number'
}

function isStoredNote(value: unknown, documentId: DocumentId): value is Omit<NoteRecord, 'sourceTextHash'> & { sourceTextHash?: string; schemaVersion: number } {
  if (!isRecord(value)) return false
  const pageNumber = typeof value.paragraphId === 'string' ? getParagraphPageNumber(documentId, value.paragraphId) : null
  return value.schemaVersion === RECORD_SCHEMA_VERSION
    && value.documentId === documentId
    && typeof value.id === 'string'
    && typeof value.paragraphId === 'string'
    && pageNumber !== null
    && (value.id === noteRecordId(documentId, value.paragraphId)
      || (typeof value.sourceTextHash === 'string' && value.id === versionedNoteRecordId(documentId, value.paragraphId, value.sourceTextHash)))
    && (value.sourceTextHash === undefined || typeof value.sourceTextHash === 'string')
    && value.pageNumber === pageNumber
    && typeof value.text === 'string'
    && typeof value.updatedAt === 'number'
}

function assertTranslationBelongsToDocument(record: TranslationRecord) {
  if (getParagraphPageNumber(record.documentId, record.paragraphId) === null
    || !record.sourceTextHash
    || !Number.isSafeInteger(record.preprocessingVersion)
    || (record.preprocessingVersion ?? -1) < 0
    || record.id !== versionedTranslationRecordId(record.paragraphId, record.targetLanguage, record.sourceLanguage, record.sourceTextHash, record.preprocessingVersion as number)
    || !isSourceLanguage(record.sourceLanguage)
    || record.targetLanguage !== 'zh-CN'
    || !record.sourceTextHash
    || !record.translatedText.trim()) {
    throw new ReaderResultsStorageError('译文与当前文档或段落不匹配。')
  }
}

function assertNoteBelongsToDocument(record: NoteRecord) {
  if (getParagraphPageNumber(record.documentId, record.paragraphId) !== record.pageNumber
    || !record.sourceTextHash || !record.text.trim()) {
    throw new ReaderResultsStorageError('批注与当前文档或段落不匹配。')
  }
}

function translationRecordId(paragraphId: string, targetLanguage: string, sourceLanguage: string) {
  return `${paragraphId}:translation:${targetLanguage}:${sourceLanguage}`
}

function getParagraphPageNumber(documentId: DocumentId, paragraphId: string) {
  const prefix = `${documentId}:`
  if (!paragraphId.startsWith(prefix)) return null
  const identity = /^page:([1-9]\d*):paragraph:[1-9]\d*$/.exec(paragraphId.slice(prefix.length))
  if (!identity) return null
  const pageNumber = Number(identity[1])
  return Number.isSafeInteger(pageNumber) ? pageNumber : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSourceLanguage(value: unknown): value is TranslationRecord['sourceLanguage'] {
  return value === 'en' || value === 'ja' || value === 'fr' || value === 'de'
}

function asStorageError(message: string, error: unknown): ReaderResultsStorageError {
  return error instanceof ReaderResultsStorageError
    ? error
    : new ReaderResultsStorageError(message, error instanceof Error ? { cause: error } : undefined)
}

type IDBValidRecord = TranslationRecord & { schemaVersion: number } | NoteRecord & { schemaVersion: number }
