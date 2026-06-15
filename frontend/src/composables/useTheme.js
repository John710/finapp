import { ref, readonly, computed } from 'vue'

const STORAGE_KEY = 'theme'
const theme = ref('auto')
let mediaQuery = null
let systemListener = null
let initialized = false

function getMediaQuery() {
  if (typeof window === 'undefined') return null
  if (!mediaQuery) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  }
  return mediaQuery
}

function readSavedTheme() {
  if (typeof window === 'undefined') return
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && ['light', 'dark', 'auto'].includes(saved)) {
      theme.value = saved
    }
  } catch (e) {
    // ignore (e.g. storage disabled or SSR)
  }
}

export function applyTheme(value) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (value === 'dark') {
    root.classList.add('dark')
  } else if (value === 'light') {
    root.classList.remove('dark')
  } else {
    const mq = getMediaQuery()
    root.classList.toggle('dark', mq ? mq.matches : false)
  }
}

function onSystemChange(e) {
  if (theme.value === 'auto') {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', e.matches)
  }
}

function initTheme() {
  if (initialized) return
  initialized = true
  readSavedTheme()
  const mq = getMediaQuery()
  if (mq && !systemListener) {
    systemListener = onSystemChange
    mq.addEventListener('change', systemListener)
  }
  applyTheme(theme.value)
}

const isDark = computed(() => {
  if (theme.value === 'dark') return true
  if (theme.value === 'light') return false
  const mq = getMediaQuery()
  return mq ? mq.matches : false
})

export function useTheme() {
  initTheme()

  function setTheme(value) {
    theme.value = value
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, value)
      }
    } catch (e) {
      // ignore
    }
    applyTheme(value)
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return {
    theme: readonly(theme),
    isDark: readonly(isDark),
    setTheme,
    toggleTheme,
    applyTheme
  }
}
