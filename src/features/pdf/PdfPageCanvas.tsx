import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { waitForRenderCompletion } from './renderLifecycle'
import { getCssRectangleFromPdfBounds, isParagraphLocationRequestCurrent, type ParagraphLocationRequest } from './paragraphLocation'
import {
  calculateScrollOffsetForPageRatio,
  captureNormalizedPagePosition,
  isRestoreRequestCurrent,
  type ProgressPositionUpdate,
  type ReadingProgressRestoreRequest,
} from './readingProgress'

type PdfPageCanvasProps = {
  document: PDFDocumentProxy
  documentId: NonNullable<ParagraphLocationRequest['documentId']>
  pageNumber: number
  locationRequest: ParagraphLocationRequest | null
  restorePositionRequest: ReadingProgressRestoreRequest | null
  onProgressPositionChange?: (position: ProgressPositionUpdate) => void
  onUserScrollIntent?: () => void
  onRestorePositionApplied?: (requestId: number) => void
}

type RenderedPageLayout = {
  document: PDFDocumentProxy
  pageNumber: number
  containerWidth: number
  viewport: ReturnType<PDFPageProxy['getViewport']>
  cssWidth: number
  cssHeight: number
}

type HighlightRectangle = { requestId: number; left: number; top: number; width: number; height: number }

export function PdfPageCanvas({
  document,
  documentId,
  pageNumber,
  locationRequest,
  restorePositionRequest,
  onProgressPositionChange,
  onUserScrollIntent,
  onRestorePositionApplied,
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(true)
  const [renderedLayout, setRenderedLayout] = useState<RenderedPageLayout | null>(null)
  const [highlight, setHighlight] = useState<HighlightRectangle | null>(null)
  const activeRenderTask = useRef<RenderTask | null>(null)
  const handledLocationRequestId = useRef<number | null>(null)
  const handledRestoreRequestId = useRef<number | null>(null)
  const highlightTimer = useRef<number | null>(null)
  const activeScrollFrame = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || containerWidth <= 0) return
    let cancelled = false
    let renderTask: RenderTask | undefined
    setRenderError(null)
    setIsRendering(true)

    void (async () => {
      const previousTask = activeRenderTask.current
      if (previousTask) {
        await waitForRenderCompletion(previousTask)
        if (activeRenderTask.current === previousTask) activeRenderTask.current = null
      }
      if (cancelled) return

      let page
      try {
        page = await document.getPage(pageNumber)
      } catch (error) {
        if (cancelled) return
        console.error('[Marginalia PDF page load] Failed to load page.', { pageNumber, error })
        setRenderError(`PDF 第 ${pageNumber} 页加载失败。`)
        setIsRendering(false)
        return
      }
      if (cancelled) return

      try {
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = Math.min(containerWidth / baseViewport.width, 1.5)
        const viewport = page.getViewport({ scale })
        const outputScale = Math.max(1, window.devicePixelRatio || 1)
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        })
        activeRenderTask.current = renderTask
        await renderTask.promise
        if (!cancelled) {
          setRenderedLayout({
            document,
            pageNumber,
            containerWidth,
            viewport,
            cssWidth: Number.parseFloat(canvas.style.width),
            cssHeight: Number.parseFloat(canvas.style.height),
          })
          setIsRendering(false)
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === 'RenderingCancelledException')) return
        setRenderedLayout(null)
        console.error('[Marginalia PDF page render] Failed to render page.', { pageNumber, error })
        setRenderError(`PDF 第 ${pageNumber} 页渲染失败。`)
        setIsRendering(false)
      } finally {
        if (activeRenderTask.current === renderTask) activeRenderTask.current = null
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [containerWidth, document, pageNumber])

  useEffect(() => {
    setHighlight(null)
    if (activeScrollFrame.current) {
      activeScrollFrame.current.scrollTo({ top: activeScrollFrame.current.scrollTop, behavior: 'auto' })
      activeScrollFrame.current = null
    }
    const frame = containerRef.current?.closest<HTMLElement>('.pdf-page-frame')
    frame?.scrollTo({ left: 0, top: 0, behavior: 'auto' })
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = null
  }, [document, pageNumber])

  useEffect(() => () => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
  }, [])

  const capturePosition = (reason: ProgressPositionUpdate['reason']) => {
    const canvas = canvasRef.current
    const frame = containerRef.current?.closest<HTMLElement>('.pdf-page-frame')
    if (!canvas || !frame || !renderedLayout
      || renderedLayout.document !== document
      || renderedLayout.pageNumber !== pageNumber
      || renderedLayout.containerWidth !== containerWidth) return
    const frameRect = frame.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const position = captureNormalizedPagePosition({
      frameScrollLeft: frame.scrollLeft,
      frameScrollTop: frame.scrollTop,
      frameClientWidth: frame.clientWidth,
      frameClientHeight: frame.clientHeight,
      canvasOffsetLeft: canvasRect.left - frameRect.left - frame.clientLeft + frame.scrollLeft,
      canvasOffsetTop: canvasRect.top - frameRect.top - frame.clientTop + frame.scrollTop,
      canvasWidth: canvasRect.width,
      canvasHeight: canvasRect.height,
    })
    if (position) onProgressPositionChange?.({ document, documentId, pageNumber, ...position, reason })
  }

  useEffect(() => {
    capturePosition('layout')
  // The callback is expected to be stable; layout identity captures resize/render changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth, document, documentId, onProgressPositionChange, pageNumber, renderedLayout])

  useEffect(() => {
    const frame = containerRef.current?.closest<HTMLElement>('.pdf-page-frame')
    if (!frame || !renderedLayout
      || renderedLayout.document !== document
      || renderedLayout.pageNumber !== pageNumber
      || renderedLayout.containerWidth !== containerWidth) return
    const onScroll = () => capturePosition('scroll')
    frame.addEventListener('scroll', onScroll, { passive: true })
    return () => frame.removeEventListener('scroll', onScroll)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth, document, documentId, onProgressPositionChange, pageNumber, renderedLayout])

  useEffect(() => {
    const frame = containerRef.current?.closest<HTMLElement>('.pdf-page-frame')
    if (!frame) return
    const onIntent = () => {
      const scrollingFrame = activeScrollFrame.current
      if (scrollingFrame) {
        scrollingFrame.scrollTo({ left: scrollingFrame.scrollLeft, top: scrollingFrame.scrollTop, behavior: 'auto' })
        activeScrollFrame.current = null
      }
      setHighlight(null)
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
      highlightTimer.current = null
      onUserScrollIntent?.()
    }
    const onKeyIntent = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onIntent()
    }
    frame.addEventListener('wheel', onIntent, { passive: true })
    frame.addEventListener('touchstart', onIntent, { passive: true })
    frame.addEventListener('pointerdown', onIntent, { passive: true })
    window.addEventListener('keydown', onKeyIntent)
    return () => {
      frame.removeEventListener('wheel', onIntent)
      frame.removeEventListener('touchstart', onIntent)
      frame.removeEventListener('pointerdown', onIntent)
      window.removeEventListener('keydown', onKeyIntent)
    }
  }, [onUserScrollIntent])

  useEffect(() => {
    const request = restorePositionRequest
    if (!request || request.requestId === handledRestoreRequestId.current) return
    if (!isRestoreRequestCurrent(request, document, documentId, pageNumber)) {
      handledRestoreRequestId.current = request.requestId
      return
    }
    if (!renderedLayout
      || renderedLayout.document !== document
      || renderedLayout.pageNumber !== pageNumber
      || renderedLayout.containerWidth !== containerWidth) return
    const canvas = canvasRef.current
    const frame = containerRef.current?.closest<HTMLElement>('.pdf-page-frame')
    if (!canvas || !frame) {
      handledRestoreRequestId.current = request.requestId
      return
    }
    const frameRect = frame.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const canvasOffsetLeft = canvasRect.left - frameRect.left - frame.clientLeft + frame.scrollLeft
    const canvasOffsetTop = canvasRect.top - frameRect.top - frame.clientTop + frame.scrollTop
    const left = calculateScrollOffsetForPageRatio(
      canvasOffsetLeft, canvasRect.width, request.pageXRatio, frame.clientWidth, frame.scrollWidth - frame.clientWidth,
    )
    const top = calculateScrollOffsetForPageRatio(
      canvasOffsetTop, canvasRect.height, request.pageYRatio, frame.clientHeight, frame.scrollHeight - frame.clientHeight,
    )
    handledRestoreRequestId.current = request.requestId
    if (left === null || top === null) return
    frame.scrollTo({ left, top, behavior: 'auto' })
    onRestorePositionApplied?.(request.requestId)
  }, [containerWidth, document, documentId, onRestorePositionApplied, pageNumber, renderedLayout, restorePositionRequest])

  useEffect(() => {
    const request = locationRequest
    if (!request || request.requestId === handledLocationRequestId.current) return
    if (!isParagraphLocationRequestCurrent(request, document, documentId, pageNumber)) {
      handledLocationRequestId.current = request.requestId
      return
    }
    if (!renderedLayout
      || renderedLayout.document !== document
      || renderedLayout.pageNumber !== pageNumber
      || renderedLayout.containerWidth !== containerWidth) return

    const canvas = canvasRef.current
    const frame = containerRef.current?.closest<HTMLElement>('.pdf-page-frame')
    const stage = stageRef.current
    if (!canvas || !frame || !stage) {
      handledLocationRequestId.current = request.requestId
      return
    }
    const rectangle = getCssRectangleFromPdfBounds(
      request.pageBounds,
      renderedLayout.viewport,
      renderedLayout.cssWidth,
      renderedLayout.cssHeight,
    )
    if (!rectangle) {
      handledLocationRequestId.current = request.requestId
      return
    }

    handledLocationRequestId.current = request.requestId
    const canvasRect = canvas.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const targetTop = frame.scrollTop + canvasRect.top - frameRect.top + rectangle.top
    activeScrollFrame.current = frame
    frame.scrollTo({
      top: Math.max(0, targetTop - Math.min(72, frame.clientHeight * 0.22)),
      behavior: 'smooth',
    })

    setHighlight({
      requestId: request.requestId,
      left: canvasRect.left - stageRect.left + rectangle.left,
      top: canvasRect.top - stageRect.top + rectangle.top,
      width: rectangle.width,
      height: rectangle.height,
    })
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => {
      setHighlight((current) => current?.requestId === request.requestId ? null : current)
      highlightTimer.current = null
    }, 1350)
  }, [containerWidth, document, documentId, locationRequest, pageNumber, renderedLayout])

  return <div className="pdf-canvas-viewport" ref={containerRef}>
    <div className="pdf-canvas-stage" ref={stageRef}>
      {isRendering && <div className="canvas-status">正在渲染第 {pageNumber} 页…</div>}
      {renderError && <div className="canvas-status canvas-error">{renderError}</div>}
      <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
      {highlight && <span
        className="pdf-paragraph-location-highlight"
        aria-hidden="true"
        style={{ left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height }}
      />}
    </div>
  </div>
}
