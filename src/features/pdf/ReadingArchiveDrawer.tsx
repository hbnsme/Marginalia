import { useEffect, useRef, useState } from 'react'
import { Archive, Copy, Download, X } from 'lucide-react'
import type { NoteRecord, PdfParagraph, TranslationRecord } from './pdfTypes'
import { getNoteAssociationStatus } from './noteAssociation'
import {
  getTranslationAssociationStatus,
  getTranslationPageNumber,
} from './readerResultsStore'

export type ReadingArchiveTab = 'notes' | 'translations'

export type ReadingArchiveDrawerProps = {
  isOpen: boolean
  onClose: () => void
  notes: readonly NoteRecord[]
  translations: readonly TranslationRecord[]
  loadedPages: ReadonlySet<number>
  paragraphsById: ReadonlyMap<string, PdfParagraph>
  currentPreprocessingVersion: number
  onExportNotes: () => void
  onExportTranslations: () => void
  initialTab?: ReadingArchiveTab
}

export function getNextReadingArchiveTab(_current: ReadingArchiveTab, next: ReadingArchiveTab): ReadingArchiveTab {
  return next
}

export function serializeArchiveRecords(records: readonly (NoteRecord | TranslationRecord)[]) {
  return JSON.stringify(records, null, 2)
}

function getParagraphPosition(paragraphId: string) {
  return /:page:[1-9]\d*:paragraph:([1-9]\d*)$/u.exec(paragraphId)?.[1] ?? null
}

function previewText(text: string, maxLength = 180) {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}…` : normalized
}

function statusText(status: 'linked' | 'review' | 'unverified') {
  return status === 'linked' ? '已关联' : status === 'review' ? '待核对' : '尚未验证'
}

function copyText(text: string) {
  if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(text)
}

export function ReadingArchiveDrawer({
  isOpen,
  onClose,
  notes,
  translations,
  loadedPages,
  paragraphsById,
  currentPreprocessingVersion,
  onExportNotes,
  onExportTranslations,
  initialTab = 'notes',
}: ReadingArchiveDrawerProps) {
  const [activeTab, setActiveTab] = useState<ReadingArchiveTab>(initialTab)
  const panelRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const candidates = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), summary, a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )
      const focusable = candidates && [...candidates].filter((element) => {
        let ancestor = element.parentElement
        while (ancestor && ancestor !== panelRef.current) {
          if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
            const visibleSummary = [...ancestor.children].find((child) => child.tagName === 'SUMMARY')
            if (visibleSummary !== element) return false
          }
          ancestor = ancestor.parentElement
        }
        return true
      })
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const exportCurrent = activeTab === 'notes' ? onExportNotes : onExportTranslations
  const currentCount = activeTab === 'notes' ? notes.length : translations.length
  return <div className="reading-archive-backdrop" onClick={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <aside
      className="reading-archive-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reading-archive-title"
      ref={panelRef}
    >
      <header className="reading-archive-header">
        <div>
          <span className="reading-archive-kicker"><Archive size={13} /> MARGINALIA</span>
          <h2 id="reading-archive-title">我的抽屉</h2>
          <p>当前文档的阅读记录 · {notes.length + translations.length} 条</p>
        </div>
        <button ref={closeButtonRef} className="reading-archive-close" type="button" onClick={onClose} aria-label="关闭我的抽屉">
          <X size={18} />
        </button>
      </header>

      <div className="reading-archive-tabs" role="tablist" aria-label="档案类型">
        <button id="archive-notes-tab" type="button" role="tab" aria-selected={activeTab === 'notes'} aria-controls="reading-archive-panel"
          onClick={() => setActiveTab((current) => getNextReadingArchiveTab(current, 'notes'))}>
          笔记 <span>{notes.length}</span>
        </button>
        <button id="archive-translations-tab" type="button" role="tab" aria-selected={activeTab === 'translations'} aria-controls="reading-archive-panel"
          onClick={() => setActiveTab((current) => getNextReadingArchiveTab(current, 'translations'))}>
          译文 <span>{translations.length}</span>
        </button>
      </div>

      <section id="reading-archive-panel" className="reading-archive-content" role="tabpanel"
        aria-labelledby={activeTab === 'notes' ? 'archive-notes-tab' : 'archive-translations-tab'}>
        <div className="reading-archive-list-heading">
          <span>{activeTab === 'notes' ? '全部笔记' : '全部译文'} · {currentCount}</span>
          <button type="button" onClick={exportCurrent}><Download size={13} />{activeTab === 'notes' ? '导出全部笔记 JSON' : '导出全部译文 JSON'}</button>
        </div>
        {activeTab === 'notes' ? notes.length === 0
          ? <div className="reading-archive-empty">还没有保存的笔记。</div>
          : <div className="reading-archive-list">{notes.map((note) => {
            const status = getNoteAssociationStatus(note, loadedPages, paragraphsById)
            const paragraph = paragraphsById.get(note.paragraphId)
            const matched = status === 'linked' ? paragraph : undefined
            const paragraphPosition = getParagraphPosition(note.paragraphId)
            return <details className="reading-archive-record" key={note.id}>
              <summary>
                <span className="reading-archive-record-meta">第 {note.pageNumber} 页{paragraphPosition ? ` · 段落 ${paragraphPosition}` : ''} · {statusText(status)}</span>
                <span className="reading-archive-preview">{previewText(note.text)}</span>
              </summary>
              <div className="reading-archive-record-body">
                {matched && <p className="reading-archive-source-preview">原文：{previewText(matched.text, 260)}</p>}
                <p className="reading-archive-full-text">{note.text}</p>
                <button type="button" className="reading-archive-copy" onClick={() => copyText(note.text)}><Copy size={13} />复制笔记</button>
                <details className="reading-archive-technical">
                  <summary>记录详情</summary>
                  <dl>
                    <dt>记录 ID</dt><dd>{note.id}</dd>
                    <dt>documentId</dt><dd>{note.documentId}</dd>
                    <dt>paragraphId</dt><dd>{note.paragraphId}</dd>
                    <dt>sourceTextHash</dt><dd>{note.sourceTextHash || '（无）'}</dd>
                    <dt>更新于</dt><dd>{new Date(note.updatedAt).toLocaleString()}</dd>
                  </dl>
                </details>
              </div>
            </details>
          })}</div>
          : translations.length === 0
            ? <div className="reading-archive-empty">还没有保存的译文。</div>
            : <div className="reading-archive-list">{translations.map((translation) => {
              const status = getTranslationAssociationStatus(translation, loadedPages, paragraphsById, currentPreprocessingVersion)
              const paragraph = paragraphsById.get(translation.paragraphId)
              const matched = status === 'linked' ? paragraph : undefined
              const pageNumber = getTranslationPageNumber(translation.documentId, translation.paragraphId)
              const paragraphPosition = getParagraphPosition(translation.paragraphId)
              return <details className="reading-archive-record" key={translation.id}>
                <summary>
                  <span className="reading-archive-record-meta">第 {pageNumber ?? '?'} 页{paragraphPosition ? ` · 段落 ${paragraphPosition}` : ''} · {statusText(status)}</span>
                  <span className="reading-archive-preview">{previewText(translation.translatedText)}</span>
                </summary>
                <div className="reading-archive-record-body">
                  <p className="reading-archive-language-line">{translation.sourceLanguage} → {translation.targetLanguage}</p>
                  {matched && <p className="reading-archive-source-preview">原文：{previewText(matched.text, 260)}</p>}
                  <p className="reading-archive-full-text">{translation.translatedText}</p>
                  <button type="button" className="reading-archive-copy" onClick={() => copyText(translation.translatedText)}><Copy size={13} />复制译文</button>
                  <details className="reading-archive-technical">
                    <summary>记录详情</summary>
                    <dl>
                      <dt>记录 ID</dt><dd>{translation.id}</dd>
                      <dt>documentId</dt><dd>{translation.documentId}</dd>
                      <dt>paragraphId</dt><dd>{translation.paragraphId}</dd>
                      <dt>sourceTextHash</dt><dd>{translation.sourceTextHash || '（无）'}</dd>
                      <dt>原文语言</dt><dd>{translation.sourceLanguage}</dd>
                      <dt>目标语言</dt><dd>{translation.targetLanguage}</dd>
                      <dt>预处理版本</dt><dd>{translation.preprocessingVersion ?? '（旧版记录）'}</dd>
                      <dt>翻译来源</dt><dd>{translation.translationSource ?? '（未记录）'}</dd>
                      <dt>创建于</dt><dd>{new Date(translation.createdAt).toLocaleString()}</dd>
                    </dl>
                  </details>
                </div>
              </details>
            })}</div>}
      </section>
    </aside>
  </div>
}
