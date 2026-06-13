const LANG_TO_LOCALE = {
  ru: 'ru-RU',
  en: 'en-US'
}

export function getUserLocale() {
  if (typeof localStorage !== 'undefined') {
    const lang = localStorage.getItem('lang')
    if (lang && LANG_TO_LOCALE[lang]) return LANG_TO_LOCALE[lang]
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }
  return 'ru-RU'
}
