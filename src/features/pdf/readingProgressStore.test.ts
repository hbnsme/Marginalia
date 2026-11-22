import { describe, expect, it } from 'vitest'
import type { DocumentId } from './pdfTypes'
import {
  IndexedDbReadingProgressStore,
  READING_PROGRESS_SCHEMA_VERSION,
  type ReadingProgressRecord,
} from './readingProgressStore'

const docA = 'sha256:document-a' as DocumentId
const docB = 'sha256:document-b' as DocumentId

function progress(documentId: DocumentId, pageNumber: number, updatedAt: number): ReadingProgressRecord {
  return { documentId, pageNumber, pageXRatio: 0.2, pageYRatio: 0.8, updatedAt, schemaVersion: READING_PROGRESS_SCHEMA_VERSION }
}

describe('isolated IndexedDB reading progress store', () => {
  it('stores independent records per PDF in its own database', async () => {
    const database = new TestProgressDatabase()
    const store = new IndexedDbReadingProgressStore(database.factory)
    await store.save(progress(docA, 4, 10))
    await store.save(progress(docB, 9, 20))
    expect(await store.load(docA, 10)).toMatchObject({ pageNumber: 4, pageYRatio: 0.8 })
    expect(await store.load(docB, 10)).toMatchObject({ pageNumber: 9 })
    expect(database.openedNames).toEqual(['marginalia-reading-progress'])
  })

  it('ignores invalid or out-of-range records without rewriting them', async () => {
    const database = new TestProgressDatabase()
    const store = new IndexedDbReadingProgressStore(database.factory)
    await store.load(docA, 20)
    database.records.get('progress')!.set(docA, { ...progress(docA, 30, 10), pageYRatio: 2 })
    expect(await store.load(docA, 20)).toBeNull()
    expect(database.records.get('progress')!.get(docA)?.pageNumber).toBe(30)
  })

  it('does not let a delayed older write overwrite a newer position', async () => {
    const database = new TestProgressDatabase()
    const store = new IndexedDbReadingProgressStore(database.factory)
    expect(await store.save(progress(docA, 20, 200))).toBe(true)
    expect(await store.save(progress(docA, 5, 100))).toBe(false)
    expect(await store.load(docA, 30)).toMatchObject({ pageNumber: 20, updatedAt: 200 })
  })

  it('reports a failed write so the UI cannot claim it was saved', async () => {
    const database = new TestProgressDatabase()
    const store = new IndexedDbReadingProgressStore(database.factory)
    await store.load(docA, 10)
    database.failNextWrite = true
    await expect(store.save(progress(docA, 2, 10))).rejects.toThrow('无法保存本地阅读进度')
  })
})

type FakeRequest<T> = IDBRequest<T> & { result: T; onsuccess: ((event: Event) => void) | null }

class TestProgressDatabase {
  readonly records = new Map<string, Map<IDBValidKey, Record<string, unknown>>>()
  readonly openedNames: string[] = []
  failNextWrite = false
  readonly factory = { open: (name: string) => this.open(name) } as unknown as IDBFactory

  private open(name: string): IDBOpenDBRequest {
    this.openedNames.push(name)
    const request = { result: undefined, transaction: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null } as unknown as IDBOpenDBRequest
    const database = new TestProgressDatabaseHandle(this)
    const needsUpgrade = !this.records.has('progress')
    queueMicrotask(() => {
      Object.defineProperty(request, 'result', { configurable: true, value: database })
      Object.defineProperty(request, 'transaction', { configurable: true, value: new TestProgressTransaction(this, []) })
      if (needsUpgrade) request.onupgradeneeded?.(new Event('upgradeneeded'))
      queueMicrotask(() => request.onsuccess?.(new Event('success')))
    })
    return request
  }
}

class TestProgressDatabaseHandle {
  readonly objectStoreNames = { contains: (name: string) => this.owner.records.has(name) } as DOMStringList
  onversionchange: ((event: Event) => void) | null = null
  constructor(private readonly owner: TestProgressDatabase) {}
  createObjectStore(name: string): IDBObjectStore {
    this.owner.records.set(name, new Map())
    return new TestProgressObjectStore(this.owner, name, new TestProgressTransaction(this.owner, [name])) as unknown as IDBObjectStore
  }
  transaction(storeNames: string | string[]): IDBTransaction {
    return new TestProgressTransaction(this.owner, Array.isArray(storeNames) ? storeNames : [storeNames]) as unknown as IDBTransaction
  }
  close() {}
}

class TestProgressTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  error: DOMException | null = null
  private pending = 0

  constructor(private readonly owner: TestProgressDatabase, private readonly stores: string[]) {}
  objectStore(name: string): IDBObjectStore {
    if (!this.stores.includes(name)) throw new Error(`Unexpected store: ${name}`)
    return new TestProgressObjectStore(this.owner, name, this) as unknown as IDBObjectStore
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

class TestProgressObjectStore {
  constructor(private readonly owner: TestProgressDatabase, private readonly name: string, private readonly transaction: TestProgressTransaction) {}
  get(key: IDBValidKey) {
    const request = fakeRequest<Record<string, unknown> | undefined>(undefined)
    this.transaction.schedule(() => completeRequest(request, this.owner.records.get(this.name)!.get(key)))
    return request as IDBRequest<Record<string, unknown> | undefined>
  }
  put(value: Record<string, unknown>) {
    const request = fakeRequest<IDBValidKey>(value.documentId as IDBValidKey)
    this.transaction.schedule(() => {
      if (this.owner.failNextWrite) {
        this.owner.failNextWrite = false
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      this.owner.records.get(this.name)!.set(value.documentId as IDBValidKey, { ...value })
      completeRequest(request, value.documentId as IDBValidKey)
    })
    return request as IDBRequest<IDBValidKey>
  }
}

function fakeRequest<T>(result: T): FakeRequest<T> {
  return { result, onsuccess: null } as unknown as FakeRequest<T>
}

function completeRequest<T>(request: FakeRequest<T>, result: T) {
  Object.defineProperty(request, 'result', { configurable: true, value: result })
  request.onsuccess?.(new Event('success'))
}
