import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DAILY_CHARACTER_LIMIT,
  DAILY_REQUEST_LIMIT,
  MAX_TRANSLATION_LENGTH,
  TranslationProtectionStore,
  TranslationQuotaError,
  shanghaiDayKey,
  shanghaiResetAt,
  translationCacheKey,
} from '../../../server/translationProtection.mjs'

const stores: TranslationProtectionStore[] = []
function makeStore(options: ConstructorParameters<typeof TranslationProtectionStore>[0] = {}) {
  const store = new TranslationProtectionStore({ dbPath: ':memory:', ...options })
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

describe('translation protection ledger and cache', () => {
  it('uses the 3000 character single request boundary', () => {
    expect(MAX_TRANSLATION_LENGTH).toBe(3_000)
  })

  it('blocks daily character and request budgets atomically', () => {
    const store = makeStore({ now: () => new Date('2026-11-02T02:00:00.000Z') })
    store.reserveUsage(DAILY_CHARACTER_LIMIT)
    expect(() => store.reserveUsage(1)).toThrowError(TranslationQuotaError)
    expect(() => store.reserveUsage(1)).toThrowError(expect.objectContaining({ code: 'daily-character-limit', statusCode: 429 }))

    const requestStore = makeStore({ now: () => new Date('2026-11-02T02:00:00.000Z') })
    for (let i = 0; i < DAILY_REQUEST_LIMIT; i += 1) requestStore.reserveUsage(1)
    expect(requestStore.getUsage().remainingRequests).toBe(0)
    expect(() => requestStore.reserveUsage(1)).toThrowError(expect.objectContaining({ code: 'daily-request-limit' }))
  })

  it('resets the usage key at Beijing midnight', () => {
    const before = new Date('2026-11-02T15:59:59.000Z')
    const after = new Date('2026-11-02T16:00:00.000Z')
    expect(shanghaiDayKey(before)).toBe('2026-11-02')
    expect(shanghaiDayKey(after)).toBe('2026-11-03')
    expect(shanghaiResetAt(before)).toBe('2026-11-03 00:00（北京时间）')
  })

  it.each([
    ['crosses midnight', '2026-11-02T15:59:59.000Z', '2026-11-03 00:00（北京时间）'],
    ['crosses month end', '2026-11-30T15:00:00.000Z', '2026-12-01 00:00（北京时间）'],
    ['crosses year end', '2026-12-31T15:00:00.000Z', '2027-01-01 00:00（北京时间）'],
  ])('formats Beijing reset time correctly when it %s', (_caseName, input, expected) => {
    expect(shanghaiResetAt(new Date(input))).toBe(expected)
  })

  it('creates a content hash cache key scoped by both languages', () => {
    expect(translationCacheKey('  e\u0301  ', 'en', 'zh-CN')).toBe(translationCacheKey('é', 'en', 'zh-CN'))
    expect(translationCacheKey('same text', 'en', 'zh-CN')).not.toBe(translationCacheKey('same text', 'ja', 'zh-CN'))
    expect(translationCacheKey('same text', 'en', 'zh-CN')).not.toBe(translationCacheKey('same text', 'en', 'ja'))
  })

  it('preserves the ledger across store restart without storing source text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'marginalia-quota-'))
    const dbPath = join(directory, 'ledger.sqlite')
    try {
      const first = new TranslationProtectionStore({ dbPath, now: () => new Date('2026-11-02T02:00:00.000Z') })
      first.reserveUsage(123)
      const key = translationCacheKey('private source text', 'en', 'zh-CN')
      first.saveTranslation(key, 'en', 'zh-CN', 'cached translation')
      first.close()
      const reopened = new TranslationProtectionStore({ dbPath, now: () => new Date('2026-11-02T02:00:00.000Z') })
      expect(reopened.getUsage()).toMatchObject({ characters: 123, requests: 1 })
      expect(reopened.getCachedTranslation(key)).toBe('cached translation')
      expect(reopened.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='translation_cache'").get()).toBeTruthy()
      expect(reopened.database.prepare('SELECT * FROM translation_cache WHERE cache_key = ?').get(key)).not.toHaveProperty('source_text')
      reopened.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
