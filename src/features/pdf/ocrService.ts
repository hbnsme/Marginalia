import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { DocumentId, PdfPageText } from './pdfTypes'
import { createParagraphId, hashSourceText } from './documentIdentity'

const JAPANESE_TESSDATA_URL = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0'
const TESSERACT_CORE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0'
const MAX_RENDER_DIMENSION = 4096
const MAX_RENDER_PIXELS = 16_000_000
const MINIMUM_CONFIDENCE = 15

let workerPromise: Promise<Worker> | null = null
let recognitionQueue: Promise<void> = Promise.resolve()

export type OcrProgress = { status: string; progress: number }

export function shouldRunOcr(pageText: PdfPageText | null | undefined) {
  return Boolean(pageText && pageText.paragraphs.length === 0)
}

export function normalizeOcrText(text: string, confidence: number) {
  return confidence < MINIMUM_CONFIDENCE ? '' : text.replace(/\r\n?/g, '\n').trim()
}

function getOcrWorker(onProgress?: (progress: OcrProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('jpn+jpn_vert', OEM.LSTM_ONLY, {
      workerPath: workerUrl,
      corePath: TESSERACT_CORE_URL,
      langPath: JAPANESE_TESSDATA_URL,
      gzip: false,
      // Tesseract.js stores trained data in IndexedDB and reuses it between sessions.
      cacheMethod: 'write',
      logger: (message) => onProgress?.({ status: message.status, progress: message.progress }),
    }).then(async (worker) => {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
        return worker
      } catch (error) {
        await worker.terminate().catch(() => undefined)
        throw error
      }
    }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

export async function renderPdfPageForOcr(document: PDFDocumentProxy, pageNumber: number): Promise<HTMLCanvasElement> {
  let page: PDFPageProxy | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    page = await document.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const pixelScale = Math.sqrt(MAX_RENDER_PIXELS / (baseViewport.width * baseViewport.height))
    const scale = Math.max(0.5, Math.min(2, MAX_RENDER_DIMENSION / baseViewport.width, MAX_RENDER_DIMENSION / baseViewport.height, pixelScale))
    const viewport = page.getViewport({ scale })
    canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建 OCR 图像画布。')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const renderedCanvas = canvas
    canvas = undefined
    return renderedCanvas
  } finally {
    if (page) page.cleanup()
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

export async function createOcrPageText(text: string, pageNumber: number, documentId: DocumentId): Promise<PdfPageText> {
  const normalizedText = text.replace(/\r\n?/g, '\n').trim()
  const paragraphs: PdfPageText['paragraphs'] = []
  for (const block of normalizedText.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    const paragraphIndex = paragraphs.length + 1
    paragraphs.push({
      id: createParagraphId(documentId, pageNumber, paragraphIndex),
      documentId,
      pageNumber,
      paragraphIndex,
      text: block,
      sourceTextHash: await hashSourceText(block),
      pageBounds: null,
      items: [],
    })
  }
  return { pageNumber, items: [], paragraphs, extractedAt: Date.now(), source: 'ocr' }
}

/** OCR stays in the browser; only model/runtime files are fetched, never the PDF or rendered page. */
export async function recognizePdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  documentId: DocumentId,
  onProgress?: (progress: OcrProgress) => void,
): Promise<PdfPageText> {
  let releaseQueue!: () => void
  const previousJob = recognitionQueue
  recognitionQueue = new Promise<void>((resolve) => { releaseQueue = resolve })
  await previousJob
  let canvas: HTMLCanvasElement | undefined
  try {
    canvas = await renderPdfPageForOcr(document, pageNumber)
    const worker = await getOcrWorker(onProgress)
    const { data } = await worker.recognize(canvas, {}, { text: true })
    return await createOcrPageText(normalizeOcrText(data.text ?? '', data.confidence ?? 0), pageNumber, documentId)
  } catch (error) {
    throw new Error('OCR 识别失败。请检查网络连接后重试。', { cause: error })
  } finally {
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    releaseQueue()
  }
}

export function resetOcrWorkerForTests() {
  workerPromise = null
  recognitionQueue = Promise.resolve()
}
