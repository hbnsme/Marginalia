import { FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PdfPageText, PdfParagraph } from './pdfTypes'
import { prepareOcrParagraphDisplayText, prepareParagraphDisplayText } from './displayText'
import { isParagraphLocatable } from './paragraphLocation'
import { ParagraphLocationButton } from './ParagraphLocationButton'
import { shouldActivateParagraphLink } from './paragraphLink'

export type PdfPageTextDisplayState = 'loading' | 'error' | 'pending' | 'no-text' | 'available'

export function getPdfPageTextDisplayState({
  isLoading,
  hasError,
  pageText,
}: {
  isLoading: boolean
  hasError: boolean
  pageText: PdfPageText | null
}): PdfPageTextDisplayState {
  if (isLoading) return 'loading'
  if (hasError) return 'error'
  if (!pageText) return 'pending'
  return pageText.paragraphs.length === 0 ? 'no-text' : 'available'
}

export function ExtractedParagraphList({
  paragraphs,
  source,
  renderParagraphActions,
  onLocateParagraph,
  onParagraphActivate,
  canLocateParagraph,
}: {
  paragraphs: readonly PdfParagraph[]
  source?: PdfPageText['source']
  renderParagraphActions?: (paragraph: PdfParagraph) => ReactNode
  onLocateParagraph?: (paragraph: PdfParagraph) => void
  onParagraphActivate?: (paragraph: PdfParagraph) => void
  canLocateParagraph?: (paragraph: PdfParagraph) => boolean
}) {
  return <div className="extracted-paragraphs">
    {paragraphs.map((paragraph) => {
      const displayText = source === 'ocr'
        ? prepareOcrParagraphDisplayText(paragraph)
        : prepareParagraphDisplayText(paragraph)
      return <article className="extracted-paragraph" key={paragraph.id} data-paragraph-id={paragraph.id} data-page-number={paragraph.pageNumber}>
        {onLocateParagraph && canLocateParagraph?.(paragraph)
          ? <ParagraphLocationButton
            paragraph={paragraph}
            label={`在 PDF 中定位原文第 ${paragraph.pageNumber}.${paragraph.paragraphIndex} 段`}
            className="paragraph-location-button extracted-paragraph-location"
            onLocate={onLocateParagraph}
            onActivate={onParagraphActivate}
          >
            <span className="paragraph-page-marker">{paragraph.pageNumber}.{paragraph.paragraphIndex}</span>
            <span className="extracted-paragraph-text">{displayText}</span>
          </ParagraphLocationButton>
          : <>
            <button type="button" className="paragraph-link-button" onClick={(event) => {
              if (!shouldActivateParagraphLink({ isTrustedClick: event.detail > 0, hasTextSelection: Boolean(window.getSelection()?.toString().trim()), isInteractiveTarget: false })) return
              onParagraphActivate?.(paragraph)
            }}><span className="paragraph-page-marker">{paragraph.pageNumber}.{paragraph.paragraphIndex}</span><span className="extracted-paragraph-text">{displayText}</span></button>
          </>}
        {renderParagraphActions?.(paragraph)}
      </article>
    })}
    <span className="extraction-footnote">原文保持不变 · 页码对应原始文件</span>
  </div>
}

export function PdfPageTextContent(props: {
  isLoading: boolean
  hasError: boolean
  pageText: PdfPageText | null
  isOcrProcessing?: boolean
  ocrFailed?: boolean
  ocrCompleted?: boolean
  onRetryOcr?: () => void
  documentId?: PdfParagraph['documentId'] | null
  onLocateParagraph?: (paragraph: PdfParagraph) => void
  onParagraphActivate?: (paragraph: PdfParagraph) => void
  renderParagraphActions?: (paragraph: PdfParagraph) => ReactNode
}) {
  const displayState = getPdfPageTextDisplayState(props)
  if (displayState === 'loading') return <div className="text-state">正在提取本页文字…</div>
  if (displayState === 'error') return <div className="text-state text-state-error" role="alert">本页文字提取失败。可以尝试重新打开文件。</div>
  if (displayState === 'pending') return null
  if (props.isOcrProcessing) return <div className="text-state" role="status">正在本地加载日语识别模型并识别本页…首次使用需要下载语言模型，完成后会缓存在此浏览器。</div>
  if (props.ocrFailed) return <div className="text-state text-state-error" role="alert">
    <span>本页 OCR 识别失败。请检查网络连接或稍后重试。</span>
    <button className="ocr-retry-button" type="button" onClick={props.onRetryOcr}>重试 OCR</button>
  </div>
  if (props.ocrCompleted && props.pageText?.paragraphs.length === 0) return <div className="text-state scan-notice" role="status">
    <FileText size={19} />
    <strong>OCR 已完成，但本页没有识别到可读取文字。页面可能为空白、扫描质量不足或版面较复杂。</strong>
  </div>
  if (displayState === 'no-text') return <div className="text-state scan-notice" role="status">
    <FileText size={19} />
    <strong>此页面暂未检测到可提取的文本，正在尝试在本地识别扫描图像。</strong>
  </div>
  return <>
    {props.pageText?.source === 'ocr' && <div className="ocr-source-label" role="status">本地 OCR 识别结果 · 可能存在识别误差</div>}
    <ExtractedParagraphList
      paragraphs={props.pageText!.paragraphs}
      source={props.pageText!.source}
      onLocateParagraph={props.onLocateParagraph}
      onParagraphActivate={props.onParagraphActivate}
      canLocateParagraph={(paragraph) => isParagraphLocatable(paragraph, props.documentId ?? null, props.pageText!.pageNumber, props.pageText!.source)}
      renderParagraphActions={props.renderParagraphActions}
    />
  </>
}
