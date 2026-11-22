export const PDFJS_WASM_RUNTIME_ASSETS = [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
] as const

/** Keep PDF.js's dynamic worker requests under Vite's configured application base. */
export function getPdfJsWasmBaseUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}pdfjs/wasm/`
}

export const PDFJS_WASM_BASE_URL = getPdfJsWasmBaseUrl(import.meta.env.BASE_URL)
