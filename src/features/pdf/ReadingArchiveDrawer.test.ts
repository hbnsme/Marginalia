import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentId, NoteRecord, PdfParagraph, TranslationRecord } from './pdfTypes'
import {
  getNextReadingArchiveTab,
  ReadingArchiveDrawer,
  serializeArchiveRecords,
} from './ReadingArchiveDrawer'

const documentId = `sha256:${'a'.repeat(64)}` as DocumentId
const paragraphId = `${documentId}:page:12:paragraph:3`
const paragraph: PdfParagraph = {
  id: paragraphId,
  documentId,
  pageNumber: 12,
  paragraphIndex: 3,
  text: 'A complete original paragraph used to identify the reading note.',
  sourceTextHash: 'paragraph-hash',
  pageBounds: null,
  items: [],
}
const note: NoteRecord = {
  id: 'note-record-12-3', documentId, paragraphId, sourceTextHash: paragraph.sourceTextHash,
  pageNumber: 12, text: 'Full note content.\nSecond line remains available.', updatedAt: 10,
}
const unlinkedNote: NoteRecord = {
  id: 'legacy-note-record', documentId, paragraphId: `${documentId}:page:8:paragraph:1`,
  sourceTextHash: 'historical-note-hash', pageNumber: 8, text: 'Legacy note remains visible in the archive.', updatedAt: 11,
}
const noteWithoutHash: NoteRecord = {
  id: 'note-without-hash', documentId, paragraphId: `${documentId}:page:5:paragraph:2`,
  pageNumber: 5, text: 'Legacy note without a source hash.', updatedAt: 9,
}
const translation: TranslationRecord = {
  id: 'translation-record-12-3', documentId, paragraphId, sourceTextHash: paragraph.sourceTextHash,
  sourceLanguage: 'en', targetLanguage: 'zh-CN', translatedText: '完整的中文译文。\n保留换行。',
  preprocessingVersion: 1, createdAt: 12,
}
const unlinkedTranslation: TranslationRecord = {
  id: 'legacy-translation-record', documentId, paragraphId: `${documentId}:page:9:paragraph:4`,
  sourceTextHash: 'historical-translation-hash', sourceLanguage: 'ja', targetLanguage: 'zh-CN', translatedText: '历史译文仍可查看。', createdAt: 13,
}
const translationWithoutHash: TranslationRecord = {
  id: 'translation-without-hash', documentId, paragraphId: `${documentId}:page:6:paragraph:1`,
  sourceLanguage: 'en', targetLanguage: 'zh-CN', translatedText: '没有摘要的旧译文。', createdAt: 14,
}

function renderArchive({
  initialTab = 'notes',
  isOpen = true,
}: { initialTab?: 'notes' | 'translations'; isOpen?: boolean } = {}) {
  return renderToStaticMarkup(createElement(ReadingArchiveDrawer, {
    isOpen,
    initialTab,
    onClose: vi.fn(),
    notes: [note, unlinkedNote, noteWithoutHash],
    translations: [translation, unlinkedTranslation, translationWithoutHash],
    loadedPages: new Set([12]),
    paragraphsById: new Map([[paragraphId, paragraph]]),
    currentPreprocessingVersion: 1,
    onExportNotes: vi.fn(),
    onExportTranslations: vi.fn(),
  }))
}

describe('ReadingArchiveDrawer', () => {
  it('switches the selected tab model and renders each corresponding record collection', () => {
    expect(getNextReadingArchiveTab('notes', 'translations')).toBe('translations')
    expect(getNextReadingArchiveTab('translations', 'notes')).toBe('notes')

    const notesMarkup = renderArchive()
    expect(notesMarkup).toContain('aria-selected="true" aria-controls="reading-archive-panel">笔记')
    expect(notesMarkup).toContain('Full note content.')
    expect(notesMarkup).toContain('导出全部笔记 JSON')
    expect(notesMarkup).not.toContain('完整的中文译文。')

    const translationsMarkup = renderArchive({ initialTab: 'translations' })
    expect(translationsMarkup).toContain('aria-selected="true" aria-controls="reading-archive-panel">译文')
    expect(translationsMarkup).toContain('完整的中文译文。')
    expect(translationsMarkup).toContain('导出全部译文 JSON')
    expect(translationsMarkup).not.toContain('Full note content.')
  })

  it('shows every linked and unresolved record with a conservative association label', () => {
    const notesMarkup = renderArchive()
    expect(notesMarkup).toContain('笔记 <span>3</span>')
    expect(notesMarkup).toContain('第 12 页 · 段落 3 · 已关联')
    expect(notesMarkup).toContain('第 8 页 · 段落 1 · 尚未验证')
    expect(notesMarkup).toContain('第 5 页 · 段落 2 · 待核对')
    expect(notesMarkup).toContain('Legacy note remains visible in the archive.')
    expect(notesMarkup).toContain('Legacy note without a source hash.')

    const translationMarkup = renderArchive({ initialTab: 'translations' })
    expect(translationMarkup).toContain('译文 <span>3</span>')
    expect(translationMarkup).toContain('第 12 页 · 段落 3 · 已关联')
    expect(translationMarkup).toContain('第 9 页 · 段落 4 · 尚未验证')
    expect(translationMarkup).toContain('第 6 页 · 段落 1 · 待核对')
    expect(translationMarkup).toContain('历史译文仍可查看。')
    expect(translationMarkup).toContain('没有摘要的旧译文。')
  })

  it('includes complete expanded text and keeps technical metadata inside closed details', () => {
    const notesMarkup = renderArchive()
    expect(notesMarkup).toContain('Full note content.\nSecond line remains available.')
    expect(notesMarkup).toContain('复制笔记')
    expect(notesMarkup).toContain('原文：A complete original paragraph used to identify the reading note.')
    expect(notesMarkup).toContain('<summary>记录详情</summary>')
    expect(notesMarkup).toContain('sourceTextHash')
    expect(notesMarkup).not.toMatch(/<details class="reading-archive-technical" open/u)

    const translationMarkup = renderArchive({ initialTab: 'translations' })
    expect(translationMarkup).toContain('完整的中文译文。\n保留换行。')
    expect(translationMarkup).toContain('复制译文')
    expect(translationMarkup).not.toContain('en → zh-CN · 预处理 v1')
    expect(translationMarkup).toContain('<dt>预处理版本</dt><dd>1</dd>')
    expect(translationMarkup).not.toMatch(/<details class="reading-archive-technical" open/u)
  })

  it('serializes all note and translation records with their original fields for JSON export', () => {
    expect(JSON.parse(serializeArchiveRecords([note, unlinkedNote, noteWithoutHash]))).toEqual([note, unlinkedNote, noteWithoutHash])
    expect(JSON.parse(serializeArchiveRecords([translation, unlinkedTranslation, translationWithoutHash]))).toEqual([translation, unlinkedTranslation, translationWithoutHash])
  })

  it('renders no overlay when closed so the surrounding reading view remains mounted', () => {
    expect(renderArchive({ isOpen: false })).toBe('')
  })
})
