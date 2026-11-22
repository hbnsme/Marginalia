import type { DocumentId } from './pdfTypes'

const DATABASE_NAME = 'marginalia-reading-progress'
const DATABASE_VERSION = 1
const PROGRESS_STORE = 'progress'
export const READING_PROGRESS_SCHEMA_VERSION = 1 as const

export type ReadingProgressRecord = {
  documentId: DocumentId
  pageNumber: number
  pageXRatio: number
  pageYRatio: number
  updatedAt: number
  schemaVersion: typeof READING_PROGRESS_SCHEMA_VERSION
}

export class ReadingProgressStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReadingProgressStorageError'
  }
}

export interface ReadingProgressStore {
  load(documentId: DocumentId, pageCount: number): Promise<ReadingProgressRecord | null>
  save(record: ReadingProgressRecord): Promise<boolean>
}

export function parseReadingProgressRecord(
  value: unknown,
  documentId: DocumentId,
  pageCount?: number,
): ReadingProgressRecord | null {
  if (!isRecord(value)
    || value.schemaVersion !== READING_PROGRESS_SCHEMA_VERSION
    || value.documentId !== documentId
    || !Number.isSafeInteger(value.pageNumber) || (value.pageNumber as number) < 1
    || (pageCount !== undefined && (value.pageNumber as number) > pageCount)
    || !isRatio(value.pageXRatio)
    || !isRatio(value.pageYRatio)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return null
  return {
    documentId,
    pageNumber: value.pageNumber as number,
    pageXRatio: value.pageXRatio,
    pageYRatio: value.pageYRatio,
    updatedAt: value.updatedAt,
    schemaVersion: READING_PROGRESS_SCHEMA_VERSION,
  }
}

export class IndexedDbReadingProgressStore implements ReadingProgressStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory | undefined = getIndexedDbFactory()) {}

  async load(documentId: DocumentId, pageCount: number): Promise<ReadingProgressRecord | null> {
    const database = await this.openDatabase()
    const transaction = database.transaction(PROGRESS_STORE, 'readonly')
    const done = transactionDone(transaction)
    const request = transaction.objectStore(PROGRESS_STORE).get(documentId)
    try {
      const result = await requestResult(request)
      await done
      return parseReadingProgressRecord(result, documentId, pageCount)
    } catch (error) {
      await done.catch(() => undefined)
      throw asStorageError('无法读取本地阅读进度。', error)
    }
  }

  async save(record: ReadingProgressRecord): Promise<boolean> {
    if (!parseReadingProgressRecord(record, record.documentId)) {
      throw new ReadingProgressStorageError('阅读进度记录无效。')
    }
    const database = await this.openDatabase()
    const transaction = database.transaction(PROGRESS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(PROGRESS_STORE)
    const existingRequest = store.get(record.documentId)
    let wroteRecord = false
    existingRequest.onsuccess = () => {
      const existing = parseReadingProgressRecord(existingRequest.result, record.documentId)
      // A delayed older write must never replace a newer position.
      if (existing && existing.updatedAt >= record.updatedAt) return
      store.put(record)
      wroteRecord = true
    }
    try {
      await done
      return wroteRecord
    } catch (error) {
      throw asStorageError('无法保存本地阅读进度。', error)
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new ReadingProgressStorageError('此浏览器环境不支持 IndexedDB。'))
    if (this.databasePromise) return this.databasePromise

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(PROGRESS_STORE)) {
          database.createObjectStore(PROGRESS_STORE, { keyPath: 'documentId' })
        }
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          this.databasePromise = null
        }
        resolve(request.result)
      }
      request.onerror = () => reject(asStorageError('无法打开本地阅读进度数据库。', request.error))
      request.onblocked = () => reject(new ReadingProgressStorageError('本地阅读进度数据库被其他标签页阻止。'))
    })
    const databasePromise = opening.catch((error: unknown) => {
      this.databasePromise = null
      throw error instanceof ReadingProgressStorageError
        ? error
        : asStorageError('无法打开本地阅读进度数据库。', error)
    })
    this.databasePromise = databasePromise
    return databasePromise
  }
}

export const readingProgressStore: ReadingProgressStore = new IndexedDbReadingProgressStore()

function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asStorageError(message: string, error: unknown): ReadingProgressStorageError {
  return error instanceof ReadingProgressStorageError
    ? error
    : new ReadingProgressStorageError(message, error instanceof Error ? { cause: error } : undefined)
}
