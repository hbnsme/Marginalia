import { getDocument, GlobalWorkerOptions, VerbosityLevel, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'
import { PdfLoadError, type DocumentId } from './pdfTypes'
import { createDocumentId } from './documentIdentity'
import { organizePageText, type NeighborPageTextLayout } from './pdfText'
import { PDFJS_WASM_BASE_URL } from './pdfJsResources'
import { classifyPdfTextExtraction, summarizePdfTextContent } from './pdfTextDiagnostics'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const pageTextContentCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<NeighborPageTextLayout>>>()

function getPageTextLayout(document: PDFDocumentProxy, pageNumber: number): Promise<NeighborPageTextLayout> {
  let documentCache = pageTextContentCache.get(document)
  if (!documentCache) {
    documentCache = new Map()
    pageTextContentCache.set(document, documentCache)
  }
  const existing = documentCache.get(pageNumber)
  if (existing) return existing

  const request = document.getPage(pageNumber).then(async (page) => ({
    pageNumber,
    pageHeight: Math.abs(page.view[3] - page.view[1]),
    content: await page.getTextContent(),
  })).catch((error: unknown) => {
    documentCache!.delete(pageNumber)
    throw error
  })
  documentCache.set(pageNumber, request)
  return request
}

function trimPageTextContentCache(document: PDFDocumentProxy, centerPage: number) {
  const cache = pageTextContentCache.get(document)
  if (!cache) return
  for (const pageNumber of cache.keys()) {
    if (Math.abs(pageNumber - centerPage) > 2) cache.delete(pageNumber)
  }
  while (cache.size > 5) {
    const farthest = [...cache.keys()].sort((left, right) =>
      Math.abs(right - centerPage) - Math.abs(left - centerPage))[0]
    if (farthest === undefined) break
    cache.delete(farthest)
  }
}

export async function openPdfFile(file: File): Promise<{ documentId: DocumentId; document: PDFDocumentProxy; loadingTask: PDFDocumentLoadingTask }> {
  if (file.size === 0) {
    throw new PdfLoadError('empty', '这个文件是空的，请选择一份有效的 PDF。')
  }
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
    throw new PdfLoadError('not-pdf', '请选择 PDF 文件。')
  }

  let loadingTask: PDFDocumentLoadingTask | undefined
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const documentId = await createDocumentId(bytes)
    loadingTask = getDocument({ data: bytes, wasmUrl: PDFJS_WASM_BASE_URL, verbosity: VerbosityLevel.WARNINGS })
    try {
      const document = await Promise.race([
        loadingTask.promise,
        new Promise<never>((_, reject) => {
          loadingTask!.onPassword = () => {
            reject(new PdfLoadError('password', '这份 PDF 受密码保护，当前版本无法打开。'))
          }
        }),
      ])
      return { documentId, document, loadingTask }
    } catch (error) {
      void loadingTask.destroy()
      if (error instanceof PdfLoadError) throw error
      if (error instanceof Error && error.name === 'PasswordException') {
        throw new PdfLoadError('password', '这份 PDF 受密码保护，当前版本无法打开。')
      }
      throw new PdfLoadError('invalid', '无法读取这份 PDF。文件可能已损坏，或格式暂不受支持。', { cause: error })
    }
  } catch (error) {
    if (error instanceof PdfLoadError) throw error
    throw new PdfLoadError('read-failed', '读取文件失败，请检查文件是否仍可访问后重试。')
  }
}

export async function extractPdfPageText(document: PDFDocumentProxy, pageNumber: number, documentId: DocumentId) {
  const previousPageNumber = pageNumber > 1 ? pageNumber - 1 : null
  const nextPageNumber = pageNumber < document.numPages ? pageNumber + 1 : null
  const [currentLayout, previousPage, nextPage] = await Promise.all([
    getPageTextLayout(document, pageNumber),
    previousPageNumber === null
      ? Promise.resolve(null)
      : getPageTextLayout(document, previousPageNumber).catch(() => null),
    nextPageNumber === null
      ? Promise.resolve(null)
      : getPageTextLayout(document, nextPageNumber).catch(() => null),
  ])
  trimPageTextContentCache(document, pageNumber)
  const textContent = currentLayout.content
  const summary = summarizePdfTextContent(textContent)
  if (import.meta.env.DEV) {
    console.info('[Marginalia PDF text extraction] Raw PDF.js text content.', {
      documentId,
      pageNumber,
      ...summary,
    })
  }

  const extractedPage = await organizePageText(textContent, pageNumber, documentId, {
    pageHeight: currentLayout.pageHeight,
    previousPage,
    nextPage,
  })
  if (import.meta.env.DEV) {
    console.info('[Marginalia PDF text extraction] Result.', {
      documentId,
      pageNumber,
      category: classifyPdfTextExtraction(summary, extractedPage.paragraphs.length),
      paragraphCount: extractedPage.paragraphs.length,
      extractedItemCount: extractedPage.items.length,
    })
  }
  return extractedPage
}
