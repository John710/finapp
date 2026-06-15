import { createI18n } from 'vue-i18n'

const modules = import.meta.glob('./locales/*.json', { eager: true })

const messages = {}
for (const path in modules) {
  const match = path.match(/\/([a-zA-Z0-9_-]+)\.json$/)
  if (match) {
    messages[match[1]] = modules[path].default
  }
}

const availableLocales = Object.keys(messages)
const fallbackLocale = availableLocales.includes('en') ? 'en' : availableLocales[0] || 'en'

function hasSavedLocale() {
  try {
    return Boolean(localStorage.getItem('lang'))
  } catch (e) {
    return false
  }
}

function detectLanguage() {
  try {
    const saved = localStorage.getItem('lang')
    if (saved && availableLocales.includes(saved)) return saved
  } catch (e) {
    // ignore (e.g. storage disabled or SSR)
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      const lang = navigator.language.split('-')[0]
      if (availableLocales.includes(lang)) return lang
    }
  } catch (e) {
    // ignore
  }
  return fallbackLocale
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLanguage(),
  fallbackLocale,
  messages
})

/**
 * Apply the server-configured default language when the user has not
 * explicitly chosen a language. This lets `DEFAULT_LANG` override the
 * browser's `navigator.language` on first visit.
 */
export function applyServerDefault(defaultLanguage) {
  if (hasSavedLocale()) return
  if (defaultLanguage && availableLocales.includes(defaultLanguage)) {
    i18n.global.locale.value = defaultLanguage
  }
}

export default i18n
