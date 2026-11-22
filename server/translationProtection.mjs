import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const DAILY_CHARACTER_LIMIT = 20_000
export const DAILY_REQUEST_LIMIT = 100
export const MAX_TRANSLATION_LENGTH = 3_000

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_TRANSLATION_DB_PATH = resolve(projectRoot, '.local-data', 'translation-protection.sqlite')

export class TranslationQuotaError extends Error {
  constructor(code, usage) {
    super(code === 'daily-character-limit'
      ? `今日翻译字符额度已用完（${DAILY_CHARACTER_LIMIT} 字符）；将于 ${usage.resetAt} 重置。`
      : `今日翻译请求次数已用完（${DAILY_REQUEST_LIMIT} 次）；将于 ${usage.resetAt} 重置。`)
    this.name = 'TranslationQuotaError'
    this.code = code
    this.statusCode = 429
    this.usage = usage
  }
}

export function shanghaiDayKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return `${value.year}-${value.month}-${value.day}`
}

export function shanghaiResetAt(date) {
  const [year, month, day] = shanghaiDayKey(date).split('-').map(Number)
  const midnightUtc = Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(midnightUtc))
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}（北京时间）`
}

export function translationCacheKey(text, sourceLanguage, targetLanguage, preprocessingVersion = 0) {
  const normalizedText = text.normalize('NFC').trim()
  return createHash('sha256')
    .update(JSON.stringify([normalizedText, sourceLanguage, targetLanguage, preprocessingVersion]), 'utf8')
    .digest('hex')
}

export class TranslationProtectionStore {
  constructor({ dbPath = DEFAULT_TRANSLATION_DB_PATH, now = () => new Date() } = {}) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
    this.now = now
    this.database = new DatabaseSync(dbPath)
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS daily_usage (
        day_key TEXT PRIMARY KEY,
        characters INTEGER NOT NULL,
        requests INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS translation_cache (
        cache_key TEXT PRIMARY KEY,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }

  getUsage(date = this.now()) {
    const dayKey = shanghaiDayKey(date)
    const row = this.database.prepare('SELECT characters, requests FROM daily_usage WHERE day_key = ?').get(dayKey)
    const characters = Number(row?.characters ?? 0)
    const requests = Number(row?.requests ?? 0)
    return {
      day: dayKey,
      characters,
      requests,
      characterLimit: DAILY_CHARACTER_LIMIT,
      requestLimit: DAILY_REQUEST_LIMIT,
      remainingCharacters: Math.max(0, DAILY_CHARACTER_LIMIT - characters),
      remainingRequests: Math.max(0, DAILY_REQUEST_LIMIT - requests),
      resetAt: shanghaiResetAt(date),
    }
  }

  getCachedTranslation(cacheKey) {
    return this.database.prepare('SELECT translated_text AS translatedText FROM translation_cache WHERE cache_key = ?').get(cacheKey)?.translatedText ?? null
  }

  reserveUsage(characters, date = this.now()) {
    const dayKey = shanghaiDayKey(date)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.getUsage(date)
      if (characters > current.remainingCharacters) throw new TranslationQuotaError('daily-character-limit', current)
      if (current.requests >= DAILY_REQUEST_LIMIT) throw new TranslationQuotaError('daily-request-limit', current)
      this.database.prepare(`
        INSERT INTO daily_usage(day_key, characters, requests) VALUES (?, ?, 1)
        ON CONFLICT(day_key) DO UPDATE SET characters = characters + excluded.characters, requests = requests + 1
      `).run(dayKey, characters)
      this.database.exec('COMMIT')
      return this.getUsage(date)
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveTranslation(cacheKey, sourceLanguage, targetLanguage, translatedText) {
    this.database.prepare(`
      INSERT INTO translation_cache(cache_key, source_language, target_language, translated_text, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET translated_text = excluded.translated_text, created_at = excluded.created_at
    `).run(cacheKey, sourceLanguage, targetLanguage, translatedText, this.now().toISOString())
  }

  close() {
    this.database.close()
  }
}
