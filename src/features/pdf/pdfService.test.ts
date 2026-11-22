import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfPageText, openPdfFile } from './pdfService'
import { ExtractedParagraphList, PdfPageTextContent } from './PdfPageTextContent'

// Vite's ?url worker import is a browser asset URL. Point this Node-only
// integration test at PDF.js's local worker module instead.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
).href

describe('PDF loading and page text extraction', () => {
  it('loads a real two-page PDF and extracts text under the original page numbers', async () => {
    const fixtureBytes = await readFile(new URL('./fixtures/text-two-page.pdf', import.meta.url))
    const fixtureFile = new File([Uint8Array.from(fixtureBytes)], 'marginalia-test.pdf', { type: 'application/pdf' })
    const opened = await openPdfFile(fixtureFile)
    const diagnosticLog = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      expect(opened.document.numPages).toBe(2)
      const firstPdfPage = await opened.document.getPage(1)
      const secondPdfPage = await opened.document.getPage(2)
      const firstViewport = firstPdfPage.getViewport({ scale: 1 })
      const secondViewport = secondPdfPage.getViewport({ scale: 1 })
      const [firstOperators, secondOperators] = await Promise.all([
        firstPdfPage.getOperatorList(),
        secondPdfPage.getOperatorList(),
      ])
      expect(firstViewport.width).toBeGreaterThan(0)
      expect(firstViewport.height).toBeGreaterThan(0)
      expect(secondViewport.width).toBeGreaterThan(0)
      expect(secondViewport.height).toBeGreaterThan(0)
      expect(firstOperators.fnArray.length).toBeGreaterThan(0)
      expect(secondOperators.fnArray.length).toBeGreaterThan(0)
      const firstPage = await extractPdfPageText(opened.document, 1, opened.documentId)
      const secondPage = await extractPdfPageText(opened.document, 2, opened.documentId)
      const originalMarkup = renderToStaticMarkup(createElement(ExtractedParagraphList, { paragraphs: firstPage.paragraphs }))
      expect(opened.documentId).toMatch(/^sha256:[a-f\d]{64}$/)
      expect(firstPage.pageNumber).toBe(1)
      expect(firstPage.paragraphs[0].text).toBe('Synthetic sample: orbit one.')
      expect(originalMarkup).toContain('Synthetic sample: orbit one.')
      expect(secondPage.pageNumber).toBe(2)
      expect(secondPage.paragraphs[0].id).toBe(`${opened.documentId}:page:2:paragraph:1`)
      expect(secondPage.paragraphs[0].text).toBe('Synthetic sample: orbit two.')
      const firstPageDiagnostic = diagnosticLog.mock.calls.find(([label, detail]) =>
        label === '[Marginalia PDF text extraction] Raw PDF.js text content.'
        && (detail as { pageNumber?: number }).pageNumber === 1,
      )
      expect(firstPageDiagnostic?.[1]).toMatchObject({
        documentId: opened.documentId,
        pageNumber: 1,
        itemsLength: expect.any(Number),
        textItemCount: expect.any(Number),
        nonEmptyTextItemCount: expect.any(Number),
        japaneseTextItemCount: expect.any(Number),
      })
      const detail = firstPageDiagnostic?.[1] as {
        itemsLength: number
        textItemCount: number
        nonEmptyTextItemCount: number
      }
      expect(detail.itemsLength).toBeGreaterThan(0)
      expect(detail.textItemCount).toBeGreaterThan(0)
      expect(detail.nonEmptyTextItemCount).toBeGreaterThan(0)
      expect(diagnosticLog.mock.calls.some(([label, result]) =>
        label === '[Marginalia PDF text extraction] Result.'
        && (result as { category?: string }).category === 'text-extracted',
      )).toBe(true)
      const diagnosticOutput = JSON.stringify(diagnosticLog.mock.calls)
      expect(diagnosticOutput).not.toContain('Synthetic sample: orbit one.')
      expect(diagnosticOutput).not.toContain('Synthetic sample: orbit two.')
    } finally {
      diagnosticLog.mockRestore()
      await opened.loadingTask.destroy()
    }
  })

  it.skipIf(!process.env.MARGINALIA_HEADER_PDF_PATH)('filters real running folios on PDF pages 76–80 while preserving the original text layer and page 77 body', async () => {
    const samplePath = process.env.MARGINALIA_HEADER_PDF_PATH!
    const fixtureBytes = await readFile(samplePath)
    const fixtureFile = new File([Uint8Array.from(fixtureBytes)], 'running-header-regression.pdf', { type: 'application/pdf' })
    const opened = await openPdfFile(fixtureFile)
    try {
      expect(opened.document.numPages).toBeGreaterThanOrEqual(81)
      const results = new Map<number, Awaited<ReturnType<typeof extractPdfPageText>>>()
      for (let pageNumber = 76; pageNumber <= 80; pageNumber += 1) {
        results.set(pageNumber, await extractPdfPageText(opened.document, pageNumber, opened.documentId))
      }

      const expectedFolios = new Map([[76, '66'], [77, '67'], [78, '68'], [79, '69'], [80, '70']])
      for (const [pageNumber, folio] of expectedFolios) {
        const pageText = results.get(pageNumber)!
        const paragraphText = pageText.paragraphs.map((paragraph) => paragraph.text).join('\n')
        const headerBandText = pageText.items.filter((item) => Math.abs(item.y - 657) <= 5).map((item) => item.text).join(' ')
        expect(headerBandText.toLowerCase()).toContain('tone')
        expect(headerBandText).toContain(folio)
        expect(paragraphText).not.toMatch(new RegExp(`(?:${folio}\\s*\\.\\s*tone|tone\\s*\\.\\s*${folio})`, 'iu'))
        expect(pageText.paragraphs.map((paragraph) => paragraph.paragraphIndex)).toEqual(pageText.paragraphs.map((_, index) => index + 1))
      }

      const page77Paragraphs = results.get(77)!.paragraphs
      const page77Text = page77Paragraphs.map((paragraph) => paragraph.text).join('\n')
      expect(page77Text).toContain('CM and the stranger')
      const thusIndex = page77Paragraphs.findIndex((paragraph) => paragraph.text.startsWith('Thus, while'))
      expect(thusIndex).toBeGreaterThan(0)
      expect(page77Paragraphs[thusIndex - 1]?.text).not.toContain('Thus, while')
      expect(results.get(77)!.items.some((item) => item.y >= 650 && item.y <= 665 && item.text.toLowerCase().includes('tone'))).toBe(true)
    } finally {
      await opened.loadingTask.destroy()
    }
  })

  it('returns a clear error for empty and corrupt files', async () => {
    await expect(openPdfFile(new File([], 'empty.pdf', { type: 'application/pdf' })))
      .rejects.toMatchObject({ code: 'empty' })
    await expect(openPdfFile(new File(['not a PDF'], 'broken.pdf', { type: 'application/pdf' })))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('keeps an image-only page empty so the UI can show the no-OCR notice', async () => {
    const fixtureBytes = await readFile(new URL('./fixtures/no-text-page.pdf', import.meta.url))
    const fixtureFile = new File([Uint8Array.from(fixtureBytes)], 'no-text-page.pdf', { type: 'application/pdf' })
    const opened = await openPdfFile(fixtureFile)
    const diagnosticLog = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const pageText = await extractPdfPageText(opened.document, 1, opened.documentId)
      expect(pageText.pageNumber).toBe(1)
      expect(pageText.items).toEqual([])
      expect(pageText.paragraphs).toEqual([])
      const noTextMarkup = renderToStaticMarkup(createElement(PdfPageTextContent, {
        isLoading: false,
        hasError: false,
        pageText,
      }))
      expect(noTextMarkup).toContain('此页面暂未检测到可提取的文本，正在尝试在本地识别扫描图像。')
      const errorMarkup = renderToStaticMarkup(createElement(PdfPageTextContent, {
        isLoading: false,
        hasError: true,
        pageText: null,
      }))
      expect(errorMarkup).toContain('本页文字提取失败')
      expect(errorMarkup).not.toContain('可能是扫描图像')
      const resultDiagnostic = diagnosticLog.mock.calls.find(([label]) =>
        label === '[Marginalia PDF text extraction] Result.',
      )
      expect(resultDiagnostic?.[1]).toMatchObject({
        documentId: opened.documentId,
        pageNumber: 1,
        category: 'no-items',
        paragraphCount: 0,
      })
    } finally {
      diagnosticLog.mockRestore()
      await opened.loadingTask.destroy()
    }
  })
})
