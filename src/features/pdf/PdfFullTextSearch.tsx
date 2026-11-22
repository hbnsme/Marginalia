import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Search, X } from 'lucide-react'
import type { DocumentId } from './pdfTypes'
import { canLocateSearchResult, isPdfTextSearchRunCurrent, normalizePdfSearchText, searchPdfText, type PdfTextSearchResult } from './pdfSearch'

type PdfFullTextSearchProps = {
  document: PDFDocumentProxy
  documentId: DocumentId
  pageCount: number
  onLocate: (result: PdfTextSearchResult) => void
}

type SearchStatus = 'idle' | 'searching' | 'complete' | 'cancelled' | 'failed'

export function PdfFullTextSearch({ document, documentId, pageCount, onLocate }: PdfFullTextSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PdfTextSearchResult[]>([])
  const [scannedPages, setScannedPages] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const [matchingParagraphCount, setMatchingParagraphCount] = useState(0)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorPage, setErrorPage] = useState<number | null>(null)
  const runId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const activeDocument = useRef({ document, documentId })
  activeDocument.current = { document, documentId }

  const invalidateCurrentSearch = () => {
    runId.current += 1
    controller.current?.abort()
    controller.current = null
  }

  useEffect(() => {
    invalidateCurrentSearch()
    setResults([])
    setScannedPages(0)
    setMatchCount(0)
    setMatchingParagraphCount(0)
    setErrorPage(null)
    setStatus('idle')
    // Changing PDF invalidates the old search without touching reader or archive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, documentId])

  useEffect(() => () => {
    invalidateCurrentSearch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleQueryChange = (value: string) => {
    invalidateCurrentSearch()
    setQuery(value)
    setResults([])
    setScannedPages(0)
    setMatchCount(0)
    setMatchingParagraphCount(0)
    setErrorPage(null)
    setStatus('idle')
  }

  const startSearch = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedQuery = normalizePdfSearchText(query)
    if (!normalizedQuery) return
    invalidateCurrentSearch()
    const id = runId.current
    const searchController = new AbortController()
    controller.current = searchController
    const requestedDocument = document
    const requestedDocumentId = documentId
    setResults([])
    setScannedPages(0)
    setMatchCount(0)
    setMatchingParagraphCount(0)
    setErrorPage(null)
    setStatus('searching')

    const isCurrent = () => isPdfTextSearchRunCurrent(
      id,
      runId.current,
      requestedDocument,
      requestedDocumentId,
      activeDocument.current.document,
      activeDocument.current.documentId,
      searchController.signal,
    )

    try {
      const summary = await searchPdfText(requestedDocument, requestedDocumentId, normalizedQuery, {
        signal: searchController.signal,
        onProgress: (progress) => {
          if (!isCurrent()) return
          setScannedPages(progress.scannedPages)
          setMatchCount(progress.matchCount)
          setMatchingParagraphCount(progress.matchingParagraphCount)
          if (progress.addedResults.length) setResults((current) => [...current, ...progress.addedResults])
        },
      })
      if (!isCurrent()) return
      setStatus(summary.cancelled ? 'cancelled' : 'complete')
    } catch (error) {
      if (!isCurrent()) return
      const pageNumber = error instanceof Error && 'pageNumber' in error && typeof error.pageNumber === 'number'
        ? error.pageNumber
        : null
      setErrorPage(pageNumber)
      setStatus('failed')
    } finally {
      if (runId.current === id) controller.current = null
    }
  }

  const cancelSearch = () => {
    if (!controller.current) return
    invalidateCurrentSearch()
    setStatus('cancelled')
  }

  const totalsText = status === 'searching'
    ? `当前累计：已扫描 ${scannedPages}/${pageCount} 页，${matchCount} 处匹配，涉及 ${matchingParagraphCount} 个段落。`
    : status === 'complete'
      ? `扫描完成：共 ${matchCount} 处匹配，涉及 ${matchingParagraphCount} 个段落。`
      : status === 'cancelled'
        ? `搜索已取消；以下为已扫描 ${scannedPages}/${pageCount} 页的累计结果：${matchCount} 处匹配，涉及 ${matchingParagraphCount} 个段落。`
        : status === 'failed'
          ? `搜索中断${errorPage ? `（第 ${errorPage} 页读取失败）` : ''}；以下为已扫描 ${scannedPages}/${pageCount} 页的累计结果：${matchCount} 处匹配，涉及 ${matchingParagraphCount} 个段落。`
          : ''

  return <section className="pdf-full-text-search" aria-label="文内全文搜索">
    <form className="pdf-search-form" onSubmit={(event) => void startSearch(event)}>
      <label htmlFor="pdf-full-text-query">文内搜索</label>
      <div className="pdf-search-controls">
        <input
          id="pdf-full-text-query"
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.currentTarget.value)}
          placeholder="搜索英文关键词"
          autoComplete="off"
        />
        <button type="submit" disabled={!normalizePdfSearchText(query) || status === 'searching'}>
          <Search size={14} />搜索
        </button>
        {status === 'searching' && <button className="pdf-search-cancel" type="button" onClick={cancelSearch} aria-label="取消搜索">
          <X size={14} />取消
        </button>}
      </div>
    </form>
    <p className="pdf-search-scope">仅搜索 PDF 内置文本层；扫描图像不在搜索范围内，也不会自动执行全文 OCR。</p>
    {status !== 'idle' && <div className="pdf-search-status" role="status" aria-live="polite">{totalsText}</div>}
    {status === 'failed' && <p className="pdf-search-error" role="alert">无法继续读取 PDF 页面，可重试搜索。</p>}
    {status === 'complete' && results.length === 0 && <p className="pdf-search-empty">未找到匹配内容。</p>}
    {results.length > 0 && <ol className="pdf-search-results" aria-label="搜索结果">
      {results.map((result) => {
        const canLocate = canLocateSearchResult(result, document, documentId)
        return <li key={`${result.paragraphId}:${result.sourceTextHash}`}>
          <button
            type="button"
            className="pdf-search-result"
            disabled={!canLocate}
            onClick={() => { if (canLocate) onLocate(result) }}
            aria-label={`第 ${result.pageNumber} 页，第 ${result.paragraphIndex} 段，匹配 ${result.matchCount} 处`}
          >
            <span className="pdf-search-result-meta">第 {result.pageNumber} 页 · 第 {result.paragraphIndex} 段 · {result.matchCount} 处</span>
            <span className="pdf-search-result-context">{result.context.before}<mark>{result.context.match}</mark>{result.context.after}</span>
            {!canLocate && <span className="pdf-search-result-unavailable">此结果当前无法安全定位</span>}
          </button>
        </li>
      })}
    </ol>}
  </section>
}
