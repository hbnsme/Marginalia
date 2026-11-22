import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { PDFJS_WASM_RUNTIME_ASSETS, getPdfJsWasmBaseUrl } from './pdfJsResources'

const wasmDirectory = new URL('../../../public/pdfjs/wasm/', import.meta.url)

describe('PDF.js runtime assets', () => {
  it('points to a trailing-slash asset directory under the Vite base path', () => {
    expect(getPdfJsWasmBaseUrl('/')).toBe('/pdfjs/wasm/')
    expect(getPdfJsWasmBaseUrl('/marginalia')).toBe('/marginalia/pdfjs/wasm/')
  })

  it('ships the exact runtime assets listed by the installed pdfjs-dist version', async () => {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', wasmDirectory), 'utf8')) as {
      pdfjsDistVersion: string
      runtimeAssets: string[]
    }
    const installedPackage = JSON.parse(await readFile(new URL('../../../node_modules/pdfjs-dist/package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    expect(manifest.pdfjsDistVersion).toBe(installedPackage.version)
    expect(manifest.runtimeAssets).toEqual([...PDFJS_WASM_RUNTIME_ASSETS])
    for (const asset of PDFJS_WASM_RUNTIME_ASSETS) {
      expect((await stat(new URL(asset, wasmDirectory))).size, asset).toBeGreaterThan(0)
    }
  })
})
