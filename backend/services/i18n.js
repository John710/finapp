import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const localesDir = join(__dirname, '..', 'locales')

const caches = new Map()

function loadLocale(lang) {
  if (caches.has(lang)) return caches.get(lang)
  try {
    const path = join(localesDir, `${lang}.json`)
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    caches.set(lang, data)
    return data
  } catch {
    // fallback to en
    if (lang !== 'en') return loadLocale('en')
    return {}
  }
}

function fallbackForKey(key) {
  // Return a human-readable placeholder instead of the raw dot-separated key
  const last = key.split('.').pop()
  if (!last) return key
  return last.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function t(key, params = {}, lang = 'en') {
  const locale = loadLocale(lang)
  const keys = key.split('.')
  let value = locale
  for (const k of keys) {
    value = value?.[k]
    if (value === undefined) return fallbackForKey(key)
  }
  if (typeof value !== 'string') return fallbackForKey(key)
  return value.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`)
}

export async function getUserLang(db, userId) {
  try {
    const { rows } = await db.query('SELECT language FROM users WHERE id = $1', [userId])
    return rows[0]?.language || process.env.DEFAULT_LANG || 'en'
  } catch {
    return process.env.DEFAULT_LANG || 'en'
  }
}

export function getReqLang(request) {
  return request.body?.language
    || request.headers['accept-language']?.split(',')[0]?.slice(0, 2)
    || process.env.DEFAULT_LANG
    || 'en'
}

export function getSupportedLocales() {
  return ['ru', 'en']
}
