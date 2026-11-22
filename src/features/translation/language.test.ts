import { describe, expect, it } from 'vitest'
import { HeuristicLanguageDetector, resolveSourceLanguage } from './language'

describe('local source language detection and selection', () => {
  const detector = new HeuristicLanguageDetector()

  it('recognizes representative English, Japanese, French, and German passages locally', () => {
    expect(detector.detect('The methods of this study are described in the paper, and the results are discussed.')?.language).toBe('en')
    expect(detector.detect('この研究では新しい方法を用いて結果を分析します。')?.language).toBe('ja')
    expect(detector.detect('Les résultats de cette étude sont importants pour la recherche et pour les lecteurs.')?.language).toBe('fr')
    expect(detector.detect('Die Ergebnisse dieser Studie sind wichtig für die Forschung und für die Leser.')?.language).toBe('de')
  })

  it('leaves uncertain short text for manual language selection', () => {
    expect(detector.detect('A short text')).toBeNull()
    expect(resolveSourceLanguage('auto', null)).toBeNull()
    expect(resolveSourceLanguage('ja', { language: 'en', confidence: 0.9 })).toBe('ja')
  })
})
