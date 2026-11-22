import { useEffect, useRef, useState, type RefObject } from 'react'
import { Copy, Sparkles, X } from 'lucide-react'
import type { DocumentId, PdfPageText, SourceLanguage } from '../pdf/pdfTypes'
import { captureParagraphSelection, type CapturedTextSelection } from './selectionTranslation'
import { translateSelectionText } from './translationProvider'

export function SelectionTranslation({ rootRef, documentId, pageText, sourceLanguage, consent, serviceReady }: {
  rootRef: RefObject<HTMLElement | null>
  documentId: DocumentId | null
  pageText: PdfPageText | null
  sourceLanguage: SourceLanguage | null
  consent: boolean
  serviceReady: boolean
}) {
  const [selection, setSelection] = useState<CapturedTextSelection | null>(null)
  const [translated, setTranslated] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const captured = captureParagraphSelection(window.getSelection(), root)
      generation.current += 1
      setSelection(captured)
      setTranslated(null)
      setError('')
      setLoading(false)
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [rootRef, documentId, pageText?.pageNumber, pageText?.extractedAt])

  useEffect(() => {
    generation.current += 1
    setSelection(null)
    setTranslated(null)
    setError('')
    setLoading(false)
  }, [documentId, pageText?.pageNumber, pageText?.extractedAt])

  const translate = async () => {
    if (!selection || loading) return
    if (!sourceLanguage) { setError('无法确定原文语言，请先在上方选择原文语言。'); return }
    if (!consent) { setError('请先确认翻译文本会提交给阿里云机器翻译。'); return }
    if (!serviceReady) { setError('翻译服务当前不可用，请检查本机翻译代理。'); return }
    const requestGeneration = ++generation.current
    setLoading(true); setError(''); setTranslated(null)
    try {
      const result = await translateSelectionText(selection.text, sourceLanguage)
      if (requestGeneration === generation.current) setTranslated(result.translatedText)
    } catch (cause) {
      if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : '划词翻译失败，请重试。')
    } finally {
      if (requestGeneration === generation.current) setLoading(false)
    }
  }
  if (!selection) return null
  const style = { left: `${Math.max(8, selection.bounds.left)}px`, top: `${Math.max(8, selection.bounds.bottom + 8)}px` }
  return <div className="selection-translation-layer" style={style} onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
    {!translated && <div className="selection-translation-toolbar">
      <span>{selection.text.length} 字符</span>
      <button type="button" disabled={loading} onClick={() => void translate()}><Sparkles size={13}/>{loading ? '正在翻译…' : '翻译选中内容'}</button>
      <button type="button" aria-label="关闭选区工具条" onClick={() => { generation.current++; setSelection(null); setTranslated(null) }}><X size={14}/></button>
    </div>}
    {(translated || error) && <section className="selection-translation-card" role="status">
      <button className="selection-translation-close" type="button" aria-label="关闭划词译文" onClick={() => { generation.current++; setSelection(null); setTranslated(null); setError('') }}><X size={14}/></button>
      <small>选中原文</small><p>{selection.text}</p>
      {translated && <><small>简体中文</small><p>{translated}</p><button type="button" onClick={() => void navigator.clipboard?.writeText(translated)}><Copy size={12}/>复制译文</button></>}
      {error && <p className="selection-translation-error" role="alert">{error}</p>}
    </section>}
  </div>
}
