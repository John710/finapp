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

export function t(key, params = {}, lang = 'ru') {
  const locale = loadLocale(lang)
  const keys = key.split('.')
  let value = locale
  for (const k of keys) {
    value = value?.[k]
    if (value === undefined) return key
  }
  if (typeof value !== 'string') return key
  return value.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`)
}

export async function getUserLang(db) {
  try {
    const { rows } = await db.query('SELECT language FROM users LIMIT 1')
    return rows[0]?.language || process.env.DEFAULT_LANG || 'ru'
  } catch {
    return process.env.DEFAULT_LANG || 'ru'
  }
}

export function getSupportedLocales() {
  return ['ru', 'en']
}
