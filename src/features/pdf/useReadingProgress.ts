import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentId } from './pdfTypes'
import type { PdfImportResult, InitialProgressReadResult } from './usePdfReader'
import {
  createReadingProgressRecord,
  nextProgressTimestamp,
  ReadingProgressRestoreController,
  shouldSaveInitialReadingPosition,
  type ProgressPositionUpdate,
  type ReadingProgressRestoreRequest,
} from './readingProgress'
import {
  readingProgressStore,
  type ReadingProgressRecord,
  type ReadingProgressStore,
} from './readingProgressStore'

type ActiveProgressSession = {
  document: PDFDocumentProxy
  documentId: DocumentId
  readSucceeded: boolean
  hasStoredProgress: boolean
  initialLayoutHandled: boolean
}

type PendingWrite = { session: ActiveProgressSession; record: ReadingProgressRecord }

export function useReadingProgress(store: ReadingProgressStore = readingProgressStore) {
  const [restoreRequest, setRestoreRequest] = useState<ReadingProgressRestoreRequest | null>(null)
  const [notice, setNotice] = useState<'restoring' | 'restored' | 'saved' | 'failed' | null>(null)
  const sessionRef = useRef<ActiveProgressSession | null>(null)
  const restoreControllerRef = useRef(new ReadingProgressRestoreController())
  const currentPositionRef = useRef<PendingWrite | null>(null)
  const pendingWriteRef = useRef<PendingWrite | null>(null)
  const pendingPageRef = useRef<{ session: ActiveProgressSession; pageNumber: number } | null>(null)
  const timerRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const lastTimestampRef = useRef(0)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())

  const flushPendingWrite = useCallback((): Promise<void> => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    const pending = pendingWriteRef.current
    pendingWriteRef.current = null
    if (!pending) return writeQueueRef.current

    const write = async () => {
      try {
        const didWrite = await store.save(pending.record)
        if (sessionRef.current !== pending.session) return
        if (didWrite && currentPositionRef.current?.record.updatedAt === pending.record.updatedAt) setNotice('saved')
        else if (!didWrite) setNotice(null)
      } catch {
        if (sessionRef.current === pending.session) setNotice('failed')
      }
    }
    const queued = writeQueueRef.current.catch(() => undefined).then(write)
    writeQueueRef.current = queued
    return queued
  }, [store])

  const readInitialProgress = useCallback(async (
    documentId: DocumentId,
    pageCount: number,
    _document: PDFDocumentProxy,
  ): Promise<InitialProgressReadResult> => {
    try {
      const stored = await store.load(documentId, pageCount)
      const memoryPosition = currentPositionRef.current
      const inMemory = memoryPosition?.session.documentId === documentId
        ? memoryPosition.record
        : null
      const progress = inMemory && (!stored || inMemory.updatedAt > stored.updatedAt) ? inMemory : stored
      return { record: progress, failed: false }
    } catch {
      const memoryPosition = currentPositionRef.current
      const inMemory = memoryPosition?.session.documentId === documentId
        ? memoryPosition.record
        : null
      return { record: inMemory, failed: true }
    }
  }, [store])

  const activateImportedDocument = useCallback((result: PdfImportResult) => {
    void flushPendingWrite()
    const session: ActiveProgressSession = {
      document: result.document,
      documentId: result.documentId,
      readSucceeded: !result.progressReadFailed,
      hasStoredProgress: Boolean(result.progress),
      initialLayoutHandled: false,
    }
    sessionRef.current = session
    currentPositionRef.current = result.progress ? { session, record: result.progress } : null
    pendingWriteRef.current = null
    pendingPageRef.current = null
    lastTimestampRef.current = result.progress?.updatedAt ?? 0
    const nextRestoreRequest = result.progress ? {
      requestId: ++requestIdRef.current,
      document: result.document,
      documentId: result.documentId,
      pageNumber: result.progress.pageNumber,
      pageXRatio: result.progress.pageXRatio,
      pageYRatio: result.progress.pageYRatio,
    } : null
    restoreControllerRef.current.activate(nextRestoreRequest)
    setRestoreRequest(nextRestoreRequest)
    setNotice(result.progressReadFailed ? 'failed' : result.progress ? 'restoring' : null)
  }, [flushPendingWrite])

  const cancelPendingRestore = useCallback(() => {
    restoreControllerRef.current.cancel()
    setRestoreRequest(null)
    setNotice((current) => current === 'restoring' ? null : current)
  }, [])

  const confirmRestore = useCallback((requestId: number) => {
    if (restoreControllerRef.current.confirm(requestId)) {
      setRestoreRequest(null)
      setNotice('restored')
    }
  }, [])

  const flushPendingWriteAfter = useCallback((pending: PendingWrite) => {
    pendingWriteRef.current = pending
    return flushPendingWrite()
  }, [flushPendingWrite])

  const noteManualPageNavigation = useCallback((pageNumber: number) => {
    cancelPendingRestore()
    const session = sessionRef.current
    if (session && Number.isSafeInteger(pageNumber) && pageNumber > 0) {
      pendingPageRef.current = { session, pageNumber }
      const timestamp = nextProgressTimestamp(Date.now(), lastTimestampRef.current)
      if (!Number.isFinite(timestamp)) return
      lastTimestampRef.current = timestamp
      const record = createReadingProgressRecord(session.documentId, pageNumber, { pageXRatio: 0, pageYRatio: 0 }, timestamp)
      if (!record) return
      const pending = { session, record }
      currentPositionRef.current = pending
      void flushPendingWriteAfter(pending)
    }
  }, [cancelPendingRestore, flushPendingWriteAfter])

  const scheduleWrite = useCallback((pending: PendingWrite, delay: number) => {
    pendingWriteRef.current = pending
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flushPendingWrite() }, delay)
  }, [flushPendingWrite])

  const onPositionChange = useCallback((position: ProgressPositionUpdate) => {
    const session = sessionRef.current
    if (!session || position.document !== session.document || position.documentId !== session.documentId
      || !Number.isSafeInteger(position.pageNumber) || position.pageNumber < 1) return
    const timestamp = nextProgressTimestamp(Date.now(), lastTimestampRef.current)
    if (!Number.isFinite(timestamp)) return
    lastTimestampRef.current = timestamp
    const record = createReadingProgressRecord(session.documentId, position.pageNumber, position, timestamp)
    if (!record) return
    const pending = { session, record }
    currentPositionRef.current = pending

    if (position.reason === 'scroll') {
      scheduleWrite(pending, 700)
      return
    }

    const pendingPage = pendingPageRef.current
    if (pendingPage?.session === session && pendingPage.pageNumber === position.pageNumber) {
      pendingPageRef.current = null
      void flushPendingWriteAfter(pending)
      return
    }
    if (!session.initialLayoutHandled) {
      session.initialLayoutHandled = true
      if (shouldSaveInitialReadingPosition(session.readSucceeded, session.hasStoredProgress)) void flushPendingWriteAfter(pending)
    }
  }, [flushPendingWrite, flushPendingWriteAfter, scheduleWrite])

  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'hidden') void flushPendingWrite()
  }, [flushPendingWrite])

  useEffect(() => {
    window.addEventListener('pagehide', flushPendingWrite)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flushPendingWrite)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void flushPendingWrite()
    }
  }, [flushPendingWrite, onVisibilityChange])

  return {
    readInitialProgress,
    activateImportedDocument,
    restoreRequest,
    confirmRestore,
    cancelPendingRestore,
    noteManualPageNavigation,
    onPositionChange,
    notice,
  }
}
