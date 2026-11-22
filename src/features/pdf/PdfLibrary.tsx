import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  ArrowDownToLine,
  Archive,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Sparkles,
} from 'lucide-react'
import { PdfPageCanvas } from './PdfPageCanvas'
import { PdfFullTextSearch } from './PdfFullTextSearch'
import { getPageNumberFromInput } from './pdfText'
import { usePdfReader } from './usePdfReader'
import { PdfPageTextContent } from './PdfPageTextContent'
import { findParagraphLinkTarget, shouldActivateParagraphLink } from './paragraphLink'
import { ParagraphLocationButton } from './ParagraphLocationButton'
import { ReadingArchiveDrawer, serializeArchiveRecords } from './ReadingArchiveDrawer'
import { SOURCE_LANGUAGES, type DocumentId, type NoteRecord, type PdfParagraph, type TranslationRecord } from './pdfTypes'
import { languageDetector, resolveSourceLanguage, type LanguageSelection } from '../translation/language'
import { TRANSLATION_PREPROCESSING_VERSION } from '../translation/translationText'
import { SelectionTranslation } from '../translation/SelectionTranslationPanel'
import { formatTranslationDisplayText } from '../translation/translationDisplayText'
import {
  createParagraphLocationRequest,
  createParagraphLocationRequestForIdentity,
  isParagraphLocatable,
  type ParagraphLocationRequest,
} from './paragraphLocation'
import { canLocateSearchResult, type PdfTextSearchResult } from './pdfSearch'
import { useReadingProgress } from './useReadingProgress'
import {
  createTranslationRecord,
  createTranslationRequest,
  canApplyTranslationResult,
  getTranslationServiceInfo,
  aliyunTranslationProvider,
  mergeTranslationRecord,
  TranslationError,
  type TranslationQuota,
} from '../translation/translationProvider'
import {
  versionedNoteRecordId,
  versionedTranslationRecordId,
  noteRecordMatchesParagraph,
  paragraphBelongsToDocument,
  ReaderResultsStorageError,
  readerResultsStore,
} from './readerResultsStore'
import {
  getNoteDraftKey,
  getNoteDraftText,
  handleNoteInputChange,
  initializeNoteDraft,
  removeNoteDraft,
  restoreNoteDraftState,
  updateNoteDraft,
  type NoteDraftState,
} from './noteDraftState'

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function PdfLibrary() {
  const inputRef = useRef<HTMLInputElement>(null)
  const sourcePanelRef = useRef<HTMLElement>(null)
  const archiveTriggerRef = useRef<HTMLButtonElement>(null)
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageMessage, setPageMessage] = useState<string | null>(null)
  const [paragraphLocationRequest, setParagraphLocationRequest] = useState<ParagraphLocationRequest | null>(null)
  const [linkedParagraphId, setLinkedParagraphId] = useState<string | null>(null)
  const [languageSelection, setLanguageSelection] = useState<LanguageSelection>('auto')
  const [translations, setTranslations] = useState<Record<string, TranslationRecord>>({})
  const [translationSaveStatuses, setTranslationSaveStatuses] = useState<Record<string, 'saving' | 'saved' | 'failed'>>({})
  const [translationMessages, setTranslationMessages] = useState<Record<string, string>>({})
  const [translatingParagraphs, setTranslatingParagraphs] = useState<Record<string, boolean>>({})
  const [translationServiceStatus, setTranslationServiceStatus] = useState<'checking' | 'ready' | 'unconfigured' | 'unavailable'>('checking')
  const [translationQuota, setTranslationQuota] = useState<TranslationQuota | null>(null)
  const [translationConsent, setTranslationConsent] = useState(false)
  const [notes, setNotes] = useState<Record<string, NoteRecord>>({})
  const [loadedParagraphsByPage, setLoadedParagraphsByPage] = useState<Record<number, PdfParagraph[]>>({})
  const [noteDrafts, setNoteDrafts] = useState<NoteDraftState>({})
  const [noteSaveStatuses, setNoteSaveStatuses] = useState<Record<string, 'dirty' | 'saving' | 'saved' | 'failed'>>({})
  const [noteSaveMessages, setNoteSaveMessages] = useState<Record<string, string>>({})
  const [editingNotes, setEditingNotes] = useState<Record<string, boolean>>({})
  const [storageMessage, setStorageMessage] = useState<string | null>(null)
  const [restoredResultsDocumentId, setRestoredResultsDocumentId] = useState<DocumentId | null>(null)
  const inFlightTranslations = useRef(new Map<string, object>())
  const paragraphLocationRequestId = useRef(0)
  const reader = usePdfReader()
  const readingProgress = useReadingProgress()
  const isRestoringResults = Boolean(reader.documentId && restoredResultsDocumentId !== reader.documentId)
  const activeTranslationDocument = useRef({ documentId: reader.documentId, generation: 0 })
  if (activeTranslationDocument.current.documentId !== reader.documentId) {
    activeTranslationDocument.current = {
      documentId: reader.documentId,
      generation: activeTranslationDocument.current.generation + 1,
    }
  }

  const detectedLanguage = languageDetector.detect(reader.pageText?.paragraphs.map((paragraph) => paragraph.text).join('\n') ?? '')
  const sourceLanguage = resolveSourceLanguage(languageSelection, detectedLanguage)
  const activateLinkedParagraph = useCallback((paragraph: PdfParagraph) => setLinkedParagraphId(paragraph.id), [])
  useEffect(() => {
    if (!linkedParagraphId) return
    const timer = window.setTimeout(() => setLinkedParagraphId(null), 1500)
    const clear = () => setLinkedParagraphId(null)
    window.addEventListener('resize', clear)
    return () => { window.clearTimeout(timer); window.removeEventListener('resize', clear) }
  }, [linkedParagraphId, reader.documentId, reader.pageNumber])
  useEffect(() => { setLinkedParagraphId(null) }, [reader.documentId, reader.pageNumber])
  useEffect(() => {
    if (!linkedParagraphId) return
    for (const panel of document.querySelectorAll<HTMLElement>('.source-text-panel, .translation-text-panel')) {
      const target = findParagraphLinkTarget(panel.querySelectorAll<HTMLElement>('[data-paragraph-id]'), linkedParagraphId)
      if (target) {
        target.dataset.paragraphLinked = 'true'
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      }
    }
    return () => document.querySelectorAll<HTMLElement>('[data-paragraph-linked="true"]').forEach((element) => { delete element.dataset.paragraphLinked })
  }, [linkedParagraphId])
  const allNotes = Object.values(notes)
  const allTranslations = Object.values(translations)
  const loadedPages = new Set(Object.keys(loadedParagraphsByPage).map(Number))
  const paragraphsById = new Map(Object.values(loadedParagraphsByPage).flat().map((paragraph) => [paragraph.id, paragraph]))
  const closeArchive = useCallback(() => setIsArchiveOpen(false), [])
  const requestParagraphLocation = useCallback((paragraph: PdfParagraph) => {
    readingProgress.cancelPendingRestore()
    setParagraphLocationRequest(null)
    const requestId = ++paragraphLocationRequestId.current
    const request = createParagraphLocationRequest(
      paragraph,
      reader.document,
      reader.documentId,
      reader.pageNumber,
      reader.pageText?.source,
      requestId,
    )
    if (request) setParagraphLocationRequest(request)
  }, [reader.document, reader.documentId, reader.pageNumber, reader.pageText?.source, readingProgress.cancelPendingRestore])
  const handlePdfUserIntent = useCallback(() => {
    readingProgress.cancelPendingRestore()
    setParagraphLocationRequest(null)
  }, [readingProgress.cancelPendingRestore])

  const exportAllNotes = () => {
    const blob = new Blob([serializeArchiveRecords(allNotes)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'marginalia-notes.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const exportAllTranslations = () => {
    const blob = new Blob([serializeArchiveRecords(allTranslations)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'marginalia-translations.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    setLanguageSelection('auto')
    setIsArchiveOpen(false)
    setTranslations({})
    setTranslationSaveStatuses({})
    setTranslationMessages({})
    setTranslatingParagraphs({})
    setTranslationConsent(false)
    inFlightTranslations.current.clear()
    setNotes({})
    setLoadedParagraphsByPage({})
    setParagraphLocationRequest(null)
    setNoteDrafts({})
    setNoteSaveStatuses({})
    setNoteSaveMessages({})
    setEditingNotes({})
    setStorageMessage(null)
  }, [reader.documentId])

  useEffect(() => {
    if (!reader.documentId || !reader.pageText || reader.isExtractingText || reader.textExtractionFailed) return
    setLoadedParagraphsByPage((current) => ({ ...current, [reader.pageText!.pageNumber]: reader.pageText!.paragraphs }))
  }, [reader.documentId, reader.pageText, reader.isExtractingText, reader.textExtractionFailed])

  useEffect(() => {
    const documentId = reader.documentId
    if (!documentId) {
      setRestoredResultsDocumentId(null)
      return
    }
    const generation = activeTranslationDocument.current.generation
    let active = true
    void readerResultsStore.loadDocument(documentId).then((result) => {
      if (!active || !canApplyTranslationResult(documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) return
      const restoredTranslations: Record<string, TranslationRecord> = {}
      const restoredTranslationStatuses: Record<string, 'saved'> = {}
      for (const translation of result.translations) {
        restoredTranslations[translation.id] = translation
        restoredTranslationStatuses[translation.id] = 'saved'
      }
      const restoredNotes: Record<string, NoteRecord> = {}
      const restoredNoteDrafts = restoreNoteDraftState(result.notes)
      const restoredNoteStatuses: Record<string, 'saved'> = {}
      for (const note of result.notes) {
        restoredNotes[note.id] = note
        if (note.sourceTextHash) restoredNoteStatuses[getNoteDraftKey({ documentId: note.documentId, id: note.paragraphId, sourceTextHash: note.sourceTextHash })!] = 'saved'
      }
      setTranslations(restoredTranslations)
      setTranslationSaveStatuses(restoredTranslationStatuses)
      setNotes(restoredNotes)
      setNoteDrafts(restoredNoteDrafts)
      setNoteSaveStatuses(restoredNoteStatuses)
      setNoteSaveMessages({})
      if (result.skippedRecords > 0) setStorageMessage(`已忽略 ${result.skippedRecords} 条格式不兼容或不完整的本地记录。`)
      setRestoredResultsDocumentId(documentId)
    }).catch((error: unknown) => {
      if (active && canApplyTranslationResult(documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
        setStorageMessage(error instanceof ReaderResultsStorageError
          ? `${error.message} 当前仍可继续阅读，但成果无法恢复。`
          : '无法读取本地阅读成果。当前仍可继续阅读。')
        setRestoredResultsDocumentId(documentId)
      }
    })
    return () => { active = false }
  }, [reader.documentId])

  useEffect(() => {
    let active = true
    void getTranslationServiceInfo().then(({ status, quota }) => {
      if (active) {
        setTranslationServiceStatus(status)
        setTranslationQuota(quota)
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => setPageDraft(String(reader.pageNumber)), [reader.pageNumber])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) {
      void reader.importFile(file, readingProgress.readInitialProgress).then((result) => {
        if (result) readingProgress.activateImportedDocument(result)
      })
    }
  }

  const goToUserPage = (nextPageNumber: number) => {
    if (!Number.isSafeInteger(nextPageNumber) || nextPageNumber < 1 || nextPageNumber > reader.pageCount) return
    readingProgress.cancelPendingRestore()
    setParagraphLocationRequest(null)
    if (nextPageNumber === reader.pageNumber) return
    if (!reader.goToPage(nextPageNumber)) return
    readingProgress.noteManualPageNavigation(nextPageNumber)
  }

  const requestSearchResultLocation = (result: PdfTextSearchResult) => {
    if (!reader.document || !canLocateSearchResult(result, reader.document, reader.documentId)) return
    const request = createParagraphLocationRequestForIdentity(
      {
        id: result.paragraphId,
        documentId: result.documentId,
        pageNumber: result.pageNumber,
        sourceTextHash: result.sourceTextHash,
        pageBounds: result.pageBounds,
      },
      reader.document,
      reader.documentId,
      ++paragraphLocationRequestId.current,
    )
    if (!request) return
    readingProgress.cancelPendingRestore()
    goToUserPage(result.pageNumber)
    setParagraphLocationRequest(request)
  }

  const commitPage = () => {
    const requestedPage = getPageNumberFromInput(pageDraft, reader.pageCount)
    if (requestedPage === null) {
      setPageMessage(`请输入 1 到 ${reader.pageCount} 之间的整数页码。`)
      setPageDraft(String(reader.pageNumber))
      return
    }
    goToUserPage(requestedPage)
    setPageMessage(null)
  }

  const handlePageKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitPage()
      event.currentTarget.blur()
    }
    if (event.key === 'Escape') {
      setPageDraft(String(reader.pageNumber))
      setPageMessage(null)
      event.currentTarget.blur()
    }
  }

  const requestParagraphTranslation = async (
    paragraph: NonNullable<typeof reader.pageText>['paragraphs'][number],
    force = false,
  ) => {
    if (!reader.documentId) return
    if (translationServiceStatus !== 'ready') {
      setTranslationMessages((current) => ({ ...current, [paragraph.id]: translationServiceStatus === 'unconfigured'
        ? '翻译服务尚未配置。'
        : '翻译服务暂不可用，请确认本机代理正在运行。' }))
      return
    }
    if (!translationConsent) {
      setTranslationMessages((current) => ({ ...current, [paragraph.id]: '请先同意将所选段落发送至阿里云机器翻译。' }))
      return
    }
    if (!sourceLanguage) {
      setTranslationMessages((current) => ({ ...current, [paragraph.id]: '无法自动识别语言，请先手动选择原文语言。' }))
      return
    }
    const translationKey = versionedTranslationRecordId(paragraph.id, 'zh-CN', sourceLanguage, paragraph.sourceTextHash, TRANSLATION_PREPROCESSING_VERSION)
    if (inFlightTranslations.current.has(translationKey)) return
    const cachedTranslation = translations[translationKey]
    if (!force && cachedTranslation?.sourceTextHash === paragraph.sourceTextHash) return
    const generation = activeTranslationDocument.current.generation
    const requestToken = {}
    inFlightTranslations.current.set(translationKey, requestToken)
    setTranslationMessages((current) => ({ ...current, [paragraph.id]: '' }))
    setTranslatingParagraphs((current) => ({ ...current, [translationKey]: true }))
    try {
      const result = await aliyunTranslationProvider.translate(
        createTranslationRequest(paragraph, sourceLanguage),
      )
      const translation = createTranslationRecord(paragraph, result)
      if (canApplyTranslationResult(paragraph.documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)
        && inFlightTranslations.current.get(translationKey) === requestToken) {
        setTranslations((current) => mergeTranslationRecord(current, translation.id, translation))
        setTranslationSaveStatuses((current) => ({ ...current, [translation.id]: 'saving' }))
        try {
          await readerResultsStore.saveTranslation(translation)
          if (canApplyTranslationResult(paragraph.documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
            setTranslationSaveStatuses((current) => ({ ...current, [translation.id]: 'saved' }))
            setStorageMessage(null)
          }
        } catch {
          if (canApplyTranslationResult(paragraph.documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
            setTranslationSaveStatuses((current) => ({ ...current, [translation.id]: 'failed' }))
            setStorageMessage('译文已生成，但未能保存到本机浏览器。请检查浏览器存储空间或权限。')
          }
        }
      }
    } catch (error) {
      const message = error instanceof TranslationError
        ? error.message
        : '翻译暂时不可用，请稍后重试。'
      if (canApplyTranslationResult(paragraph.documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)
        && inFlightTranslations.current.get(translationKey) === requestToken) {
        setTranslationMessages((current) => ({ ...current, [paragraph.id]: message }))
      }
    } finally {
      if (inFlightTranslations.current.get(translationKey) === requestToken) inFlightTranslations.current.delete(translationKey)
      if (canApplyTranslationResult(paragraph.documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
        setTranslatingParagraphs((current) => ({ ...current, [translationKey]: false }))
        void getTranslationServiceInfo().then(({ quota }) => setTranslationQuota(quota))
      }
    }
  }

  const saveParagraphNote = async (paragraph: NonNullable<typeof reader.pageText>['paragraphs'][number]) => {
    const documentId = reader.documentId
    if (!documentId || !paragraphBelongsToDocument(paragraph) || paragraph.documentId !== documentId) return
    const draftIdentity = { documentId, id: paragraph.id, sourceTextHash: paragraph.sourceTextHash }
    const draftKey = getNoteDraftKey(draftIdentity)
    if (!draftKey) return
    const paragraphNotes = Object.values(notes).filter((note) => note.paragraphId === paragraph.id)
    const existingNote = paragraphNotes.find((note) => noteRecordMatchesParagraph(note, paragraph))
    const text = getNoteDraftText(noteDrafts, draftIdentity, existingNote?.text ?? '')
    if (!text.trim()) {
      setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'failed' }))
      setNoteSaveMessages((current) => ({ ...current, [draftKey]: '请先输入批注内容。' }))
      return
    }
    const generation = activeTranslationDocument.current.generation
    const note: NoteRecord = {
      id: existingNote?.id ?? versionedNoteRecordId(documentId, paragraph.id, paragraph.sourceTextHash),
      documentId,
      paragraphId: paragraph.id,
      sourceTextHash: paragraph.sourceTextHash,
      pageNumber: paragraph.pageNumber,
      text,
      updatedAt: Date.now(),
    }
    setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'saving' }))
    setNoteSaveMessages((current) => ({ ...current, [draftKey]: '' }))
    try {
      await readerResultsStore.saveNote(note)
      if (canApplyTranslationResult(documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
        setNotes((current) => ({ ...current, [note.id]: note }))
        setNoteDrafts((current) => updateNoteDraft(current, draftIdentity, text))
        setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'saved' }))
        setEditingNotes((current) => ({ ...current, [draftKey]: false }))
        setStorageMessage(null)
      }
    } catch {
      if (canApplyTranslationResult(documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
        setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'failed' }))
        setNoteSaveMessages((current) => ({ ...current, [draftKey]: '本机存储未能保存这条批注，请重试。' }))
      }
    }
  }

  const deleteParagraphNote = async (paragraph: NonNullable<typeof reader.pageText>['paragraphs'][number]) => {
    const documentId = reader.documentId
    const note = Object.values(notes).find((entry) => entry.paragraphId === paragraph.id && noteRecordMatchesParagraph(entry, paragraph))
    if (!documentId || paragraph.documentId !== documentId || !note) return
    const draftIdentity = { documentId, id: paragraph.id, sourceTextHash: paragraph.sourceTextHash }
    const draftKey = getNoteDraftKey(draftIdentity)
    if (!draftKey) return
    const generation = activeTranslationDocument.current.generation
    setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'saving' }))
    setNoteSaveMessages((current) => ({ ...current, [draftKey]: '' }))
    try {
      await readerResultsStore.deleteNote(documentId, note.id)
      if (canApplyTranslationResult(documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
        setNotes((current) => {
          const next = { ...current }
          delete next[note.id]
          return next
        })
        setNoteDrafts((current) => removeNoteDraft(current, draftIdentity))
        setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'saved' }))
        setEditingNotes((current) => ({ ...current, [draftKey]: false }))
        setStorageMessage(null)
      }
    } catch {
      if (canApplyTranslationResult(documentId, activeTranslationDocument.current.documentId, generation, activeTranslationDocument.current.generation)) {
        setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'failed' }))
        setNoteSaveMessages((current) => ({ ...current, [draftKey]: '本机存储未能删除这条批注，请重试。' }))
      }
    }
  }

  return <div className="pdf-library">
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      aria-label="选择 PDF 文件"
      onChange={handleFileChange}
    />
    <section className="library-toolbar">
      <div className="section-title"><h2>我的文献</h2><span className="count-pill">{reader.file ? '1' : '0'}</span></div>
      <div className="toolbar-actions">
        {reader.file && <span className="loaded-file-label"><FileText size={13} />已载入本次会话</span>}
        <button className="filter-button" disabled><Archive size={14} />全部文献<ChevronDown size={13} /></button>
        <button className="import-button" onClick={() => inputRef.current?.click()} disabled={reader.isOpening}>
          <ArrowDownToLine size={15} />{reader.file ? '打开另一份 PDF' : '导入 PDF'}
        </button>
      </div>
    </section>

    {reader.error && <div className="pdf-alert" role="alert">{reader.error}</div>}

    {!reader.document && <section className="empty-library" aria-labelledby="empty-title">
      <div className="empty-art" aria-hidden="true">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="art-paper paper-back"><span /><span /><span /></div>
        <div className="art-paper paper-front"><BookOpen size={27} strokeWidth={1.25} /><i /><i /><i /></div>
        <div className="art-spark spark-a"><Sparkles size={14} /></div>
        <div className="art-spark spark-b"><Bookmark size={14} /></div>
      </div>
      <span className="empty-kicker">从一篇文献开始</span>
      <h3 id="empty-title">你的下一段深度阅读，从这里开始。</h3>
      <p>导入 PDF，浏览页面并查看提取出的原文；没有文本层的页面会尝试在本地进行 OCR。</p>
      <button className="empty-import" onClick={() => inputRef.current?.click()} disabled={reader.isOpening}>
        <ArrowDownToLine size={16} />{reader.isOpening ? '正在打开 PDF…' : '导入第一份 PDF'}
      </button>
      <span className="file-hint"><FileText size={13} />支持 PDF 文本提取与日语扫描页本地 OCR</span>
    </section>}

    {reader.document && reader.file && <section className="pdf-reading-workspace" aria-label="PDF 阅读器">
      <header className="pdf-document-bar">
        <div className="pdf-file-info">
          <span className="pdf-file-icon"><FileText size={16} /></span>
          <div className="pdf-file-name-wrap">
            <strong title={reader.file.name}>{reader.file.name}</strong>
            <span>{reader.pageCount} 页 <i>·</i> {formatFileSize(reader.file.size)}</span>
          </div>
        </div>
        <div className="pdf-document-actions">
          <button ref={archiveTriggerRef} className="reading-archive-trigger" type="button" onClick={() => setIsArchiveOpen(true)} aria-haspopup="dialog">
            <Archive size={14} />我的抽屉<span>{allNotes.length + allTranslations.length}</span>
          </button>
          <span className="document-read-only">原始文件保持不变</span>
        </div>
      </header>
      <div className="reader-local-storage-note" role="note">译文和批注保存在当前浏览器，不会自动同步到其他设备；PDF 与 OCR 图像不会被复制保存。</div>
      {isRestoringResults && <div className="reader-storage-banner" role="status">正在恢复这份文献的译文和批注…</div>}
      {storageMessage && <div className="reader-storage-banner reader-storage-banner-error" role="status">{storageMessage}</div>}
      {readingProgress.notice && <div className={`reader-progress-note${readingProgress.notice === 'failed' ? ' reader-progress-note-error' : ''}`} role="status">
        {readingProgress.notice === 'restoring' ? '正在恢复上次阅读位置…'
          : readingProgress.notice === 'restored' ? '已恢复上次阅读位置'
          : readingProgress.notice === 'saved' ? '阅读进度已保存'
            : '阅读进度未能读取或保存，仍可继续阅读。'}
      </div>}

      <div className="pdf-reader-grid">
        <section className="pdf-page-column" aria-label="PDF 页面">
          <div className="pdf-page-heading"><span>原始 PDF</span><span>第 {reader.pageNumber} 页，共 {reader.pageCount} 页</span></div>
          <PdfFullTextSearch
            document={reader.document}
            documentId={reader.documentId!}
            pageCount={reader.pageCount}
            onLocate={requestSearchResultLocation}
          />
          <div className="pdf-page-frame">
            <PdfPageCanvas
              document={reader.document}
              documentId={reader.documentId!}
              pageNumber={reader.pageNumber}
              locationRequest={paragraphLocationRequest}
              restorePositionRequest={readingProgress.restoreRequest}
              onProgressPositionChange={readingProgress.onPositionChange}
              onUserScrollIntent={handlePdfUserIntent}
              onRestorePositionApplied={readingProgress.confirmRestore}
            />
          </div>
          <nav className="pdf-pagination" aria-label="PDF 翻页">
            <button className="page-arrow" aria-label="上一页" onClick={() => goToUserPage(reader.pageNumber - 1)} disabled={reader.pageNumber <= 1}>
              <ChevronLeft size={16} />
            </button>
            <label className="page-jump-label" htmlFor="pdf-page-number">页码</label>
            <input
              id="pdf-page-number"
              className="page-number-input"
              type="text"
              inputMode="numeric"
              value={pageDraft}
              aria-label="跳转到页码"
              aria-describedby={pageMessage ? 'page-message' : undefined}
              onChange={(event) => setPageDraft(event.currentTarget.value)}
              onBlur={commitPage}
              onKeyDown={handlePageKeyDown}
            />
            <span className="page-total">/ {reader.pageCount}</span>
            <button className="page-arrow" aria-label="下一页" onClick={() => goToUserPage(reader.pageNumber + 1)} disabled={reader.pageNumber >= reader.pageCount}>
              <ChevronRight size={16} />
            </button>
          </nav>
          {pageMessage && <p id="page-message" className="page-message" role="status">{pageMessage}</p>}
        </section>

        <div className="bilingual-toolbar">
          <div className="language-control">
            <label htmlFor="source-language">原文语言</label>
            <select id="source-language" value={languageSelection} onChange={(event) => setLanguageSelection(event.currentTarget.value as LanguageSelection)}>
              <option value="auto">自动识别</option>
              {SOURCE_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
            </select>
            <span className="detected-language" role="status">
              {languageSelection === 'auto'
                ? detectedLanguage ? `识别为${SOURCE_LANGUAGES.find((language) => language.code === detectedLanguage.language)?.label}` : '请手动选择原文语言'
                : '已手动指定'}
            </span>
          </div>
          <span className="target-language-label">译文：简体中文</span>
        </div>

        <div className="bilingual-reading-grid" aria-label="原文与译文对照">
          <section ref={sourcePanelRef} className="extracted-text-panel source-text-panel" aria-label="原文段落">
            <header className="text-panel-heading">
              <div><span className="text-panel-kicker">SOURCE TEXT</span><h3>原文</h3></div>
              <span className="text-page-badge">第 {reader.pageNumber} 页</span>
            </header>
            <PdfPageTextContent
              isLoading={reader.isExtractingText}
              hasError={reader.textExtractionFailed}
              pageText={reader.pageText}
              isOcrProcessing={reader.isOcrProcessing}
              ocrFailed={reader.ocrFailed}
              ocrCompleted={reader.ocrCompleted}
              onRetryOcr={reader.retryOcr}
              documentId={reader.documentId}
              onLocateParagraph={requestParagraphLocation}
              onParagraphActivate={activateLinkedParagraph}
              renderParagraphActions={(paragraph) => {
                const paragraphNotes = Object.values(notes).filter((entry) => entry.paragraphId === paragraph.id)
                const storedNote = paragraphNotes.find((entry) => noteRecordMatchesParagraph(entry, paragraph))
                const note = storedNote
                const draftIdentity = { documentId: paragraph.documentId, id: paragraph.id, sourceTextHash: paragraph.sourceTextHash }
                const draftKey = getNoteDraftKey(draftIdentity)!
                const isEditing = editingNotes[draftKey] === true
                const noteStatus = noteSaveStatuses[draftKey]
                return <div className="paragraph-annotation" key={`${paragraph.id}:annotation`}>
                  {note && !isEditing && <div className="paragraph-note-preview"><strong>我的批注</strong><p>{note.text}</p></div>}
                  {isEditing && <div className="paragraph-note-editor">
                    <label htmlFor={`note-${paragraph.id}`}>我的批注</label>
                    <textarea
                      id={`note-${paragraph.id}`}
                      value={paragraphNotes.length > 0 && !note ? '' : getNoteDraftText(noteDrafts, draftIdentity, note?.text ?? '')}
                      maxLength={10_000}
                      rows={3}
                      onChange={(event) => handleNoteInputChange(event, (text) => {
                        setNoteDrafts((current) => updateNoteDraft(current, draftIdentity, text))
                        setNoteSaveStatuses((current) => ({ ...current, [draftKey]: 'dirty' }))
                        setNoteSaveMessages((current) => ({ ...current, [draftKey]: '' }))
                      })}
                    />
                    <div className="paragraph-note-controls">
                      <button type="button" onClick={() => void saveParagraphNote(paragraph)} disabled={noteStatus === 'saving'}>
                        {noteStatus === 'saving' ? '正在保存…' : '保存批注'}
                      </button>
                      {note && <button type="button" className="note-delete-button" onClick={() => void deleteParagraphNote(paragraph)} disabled={noteStatus === 'saving'}>删除</button>}
                      <button type="button" className="note-cancel-button" onClick={() => setEditingNotes((current) => ({ ...current, [draftKey]: false }))}>收起</button>
                    </div>
                    {noteStatus === 'dirty' && <span className="note-save-status">有未保存的修改</span>}
                    {noteStatus === 'saved' && <span className="note-save-status">已保存到本机</span>}
                    {noteStatus === 'failed' && <span className="note-save-status note-save-status-error" role="alert">{noteSaveMessages[draftKey] || '保存失败，请重试。'} 批注仍保留在编辑框中。</span>}
                  </div>}
                  {!isEditing && <button type="button" className="paragraph-note-toggle" disabled={isRestoringResults} onClick={() => {
                    setNoteDrafts((current) => initializeNoteDraft(current, draftIdentity, note?.text ?? ''))
                    setEditingNotes((current) => ({ ...current, [draftKey]: true }))
                  }}>
                    <Bookmark size={12} />{note ? '编辑批注' : '添加批注'}
                    {noteStatus === 'saved' && <span>已保存</span>}
                    {noteStatus === 'dirty' && <span className="note-save-status-error">未保存</span>}
                    {noteStatus === 'failed' && <span className="note-save-status-error">保存失败</span>}
                  </button>}
                </div>
              }}
            />
            <SelectionTranslation
              rootRef={sourcePanelRef}
              documentId={reader.documentId}
              pageText={reader.pageText}
              sourceLanguage={sourceLanguage}
              consent={translationConsent}
              serviceReady={translationServiceStatus === 'ready'}
            />
          </section>

          <section className="extracted-text-panel translation-text-panel" aria-label="中文译文">
            <header className="text-panel-heading">
              <div><span className="text-panel-kicker">TRANSLATION</span><h3>中文译文</h3></div>
              <span className="text-page-badge">简体中文</span>
            </header>
            <div className="translation-service-notice" role="status">
              <Sparkles size={14} />
              <span>{translationServiceStatus === 'checking' ? '正在检查翻译服务…'
                : translationServiceStatus === 'ready' ? '阿里云机器翻译已就绪'
                  : translationServiceStatus === 'unconfigured' ? '翻译服务尚未配置' : '本机翻译代理不可用'}</span>
              <small>仅发送当前段落原文，不发送 PDF 或整页</small>
            </div>
            {translationQuota && <div className="translation-quota" role="status">
              今日剩余 {translationQuota.remainingCharacters.toLocaleString()} / {translationQuota.characterLimit.toLocaleString()} 字符 · {translationQuota.remainingRequests} / {translationQuota.requestLimit} 次请求
            </div>}
            <label className="translation-consent">
              <input type="checkbox" checked={translationConsent} onChange={(event) => setTranslationConsent(event.currentTarget.checked)} />
              我知悉点击翻译会将所选段落提交给阿里云机器翻译
            </label>
            {reader.isExtractingText && <div className="text-state">等待原文段落…</div>}
            {!reader.isExtractingText && reader.textExtractionFailed && <div className="text-state text-state-error">提取原文失败，暂时无法翻译。</div>}
            {!reader.isExtractingText && reader.pageText?.paragraphs.length === 0 && <div className="text-state">本页没有可关联的译文。</div>}
            {!reader.isExtractingText && reader.pageText?.paragraphs.map((paragraph) => {
              const translationKey = sourceLanguage ? versionedTranslationRecordId(paragraph.id, 'zh-CN', sourceLanguage, paragraph.sourceTextHash, TRANSLATION_PREPROCESSING_VERSION) : `${paragraph.id}:unknown:zh-CN`
              const storedTranslation = translations[translationKey]
              const translation = storedTranslation?.sourceTextHash === paragraph.sourceTextHash ? storedTranslation : undefined
              const canLocateParagraph = Boolean(reader.pageText
                && isParagraphLocatable(paragraph, reader.documentId, reader.pageText.pageNumber, reader.pageText.source))
              const isOldPreprocessing = Boolean(translation && translation.preprocessingVersion !== TRANSLATION_PREPROCESSING_VERSION)
              const isTranslating = translatingParagraphs[translationKey] === true
              const translationSaveStatus = translationSaveStatuses[translationKey]
              return <article className={`translation-paragraph${linkedParagraphId === paragraph.id ? ' paragraph-link-highlight' : ''}`} key={paragraph.id} data-paragraph-id={paragraph.id} data-page-number={paragraph.pageNumber} onClick={(event) => {
                const target = event.target
                if (!shouldActivateParagraphLink({
                  isTrustedClick: event.detail > 0,
                  hasTextSelection: Boolean(window.getSelection()?.toString().trim()),
                  isInteractiveTarget: target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, [contenteditable="true"]')),
                })) return
                activateLinkedParagraph(paragraph)
                if (canLocateParagraph) requestParagraphLocation(paragraph)
              }}>
                <span className="paragraph-page-marker">{paragraph.pageNumber}.{paragraph.paragraphIndex}</span>
                {translation
                  ? <>
                    {canLocateParagraph
                      ? <ParagraphLocationButton
                        paragraph={paragraph}
                        label={`在 PDF 中定位对应原文第 ${paragraph.pageNumber}.${paragraph.paragraphIndex} 段`}
                        className="paragraph-location-button translation-location-button"
                        onLocate={requestParagraphLocation}
                        onActivate={activateLinkedParagraph}
                      ><span className="translation-location-text">{formatTranslationDisplayText(translation.translatedText)}</span></ParagraphLocationButton>
                      : <p>{formatTranslationDisplayText(translation.translatedText)}</p>}
                    {isOldPreprocessing
                      ? <span className="translation-save-status" role="status">旧版预处理译文（v{translation.preprocessingVersion}），建议重新翻译</span>
                      : translation.translationSource === 'proxy-cache'
                        ? <span className="translation-save-status" role="status">使用本机翻译缓存</span>
                        : translation.translationSource === 'upstream'
                          ? <span className="translation-save-status" role="status">本次已请求翻译服务</span>
                          : null}
                    {translationSaveStatus === 'saving' && <span className="translation-save-status" role="status">正在保存译文…</span>}
                    {translationSaveStatus === 'saved' && <span className="translation-save-status" role="status">已保存到本机</span>}
                    {translationSaveStatus === 'failed' && <span className="translation-save-status translation-save-status-error" role="alert">译文已生成，但本地保存失败。</span>}
                  </>
                  : <p className="translation-placeholder">译文将与左侧原文段落对应显示。</p>}
                <button className="paragraph-translate-button" disabled={isRestoringResults || isTranslating || translationServiceStatus === 'checking' || !sourceLanguage || !translationConsent} onClick={() => void requestParagraphTranslation(paragraph, Boolean(translation))}>
                  <Sparkles size={12} />{isTranslating ? '正在翻译…' : translation ? '重新翻译' : '翻译此段'}
                </button>
                {translationMessages[paragraph.id] && <span className="translation-inline-message" role="status">{translationMessages[paragraph.id]}</span>}
              </article>
            })}
          </section>
        </div>
      </div>
    </section>}

    {reader.document && reader.file && <ReadingArchiveDrawer
      isOpen={isArchiveOpen}
      onClose={closeArchive}
      notes={allNotes}
      translations={allTranslations}
      loadedPages={loadedPages}
      paragraphsById={paragraphsById}
      currentPreprocessingVersion={TRANSLATION_PREPROCESSING_VERSION}
      onExportNotes={exportAllNotes}
      onExportTranslations={exportAllTranslations}
    />}

    {!reader.document && <section className="workflow-strip" aria-label="阅读流程">
      {[
        { number: '01', label: '导入 PDF', icon: ArrowDownToLine },
        { number: '02', label: '对照阅读', icon: FileText },
        { number: '03', label: '记录想法', icon: Bookmark },
      ].map((step, index) => {
        const Icon = step.icon
        return <div className="workflow-step" key={step.number}>
          <span className="step-icon"><Icon size={16} strokeWidth={1.7} /></span>
          <span className="step-number">{step.number}</span>
          <span className="step-label">{step.label}</span>
          {index < 2 && <span className="step-connector" />}
        </div>
      })}
    </section>}
  </div>
}
