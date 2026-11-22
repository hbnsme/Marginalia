import type { SourceLanguage } from '../pdf/pdfTypes'

export type LanguageDetection = { language: SourceLanguage; confidence: number }

export interface LanguageDetector {
  detect(text: string): LanguageDetection | null
}

const cues: Record<Exclude<SourceLanguage, 'ja'>, ReadonlySet<string>> = {
  en: new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'this', 'are', 'from']),
  fr: new Set(['le', 'la', 'les', 'de', 'des', 'et', 'que', 'une', 'un', 'dans', 'pour', 'est', 'cette', 'avec']),
  de: new Set(['der', 'die', 'das', 'und', 'von', 'zu', 'ist', 'mit', 'ein', 'eine', 'den', 'nicht', 'für', 'diese']),
}

/** Small offline detector for MVP hints; uncertain text is left for manual choice. */
export class HeuristicLanguageDetector implements LanguageDetector {
  detect(text: string): LanguageDetection | null {
    if (/[\u3040-\u30ff]/u.test(text)) return { language: 'ja', confidence: 0.99 }
    const words = text.toLocaleLowerCase().match(/[\p{L}]+/gu) ?? []
    if (words.length < 4) return null
    const scores = (Object.entries(cues) as Array<[Exclude<SourceLanguage, 'ja'>, ReadonlySet<string>]>)
      .map(([language, wordsForLanguage]) => ({ language, count: words.filter((word) => wordsForLanguage.has(word)).length }))
      .sort((a, b) => b.count - a.count)
    const best = scores[0]
    const runnerUp = scores[1]
    if (!best || best.count < 2 || best.count === runnerUp?.count) return null
    const confidence = best.count / Math.max(1, words.length)
    if (confidence < 0.08) return null
    return { language: best.language, confidence: Math.min(0.95, confidence + 0.35) }
  }
}

export const languageDetector: LanguageDetector = new HeuristicLanguageDetector()

export type LanguageSelection = SourceLanguage | 'auto'

export function resolveSourceLanguage(selection: LanguageSelection, detected: LanguageDetection | null): SourceLanguage | null {
  return selection === 'auto' ? detected?.language ?? null : selection
}
