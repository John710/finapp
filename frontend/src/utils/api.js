import i18n from '@/i18n'

const API_URL = '/api/v1'
const t = i18n.global.t

const COINGECKO_TOAST_KEY = 'coingecko_rate_limit_toast'
const COINGECKO_TOAST_COOLDOWN = 5 * 60 * 1000 // 5 minutes

function showCoingeckoRateLimitToast() {
  const lastShown = parseInt(localStorage.getItem(COINGECKO_TOAST_KEY) || '0', 10)
  const now = Date.now()
  if (now - lastShown < COINGECKO_TOAST_COOLDOWN) return
  localStorage.setItem(COINGECKO_TOAST_KEY, String(now))
  window.$toast?.warning?.(
    t('settings.coingecko_rate_limited'),
    { duration: 8000 }
  )
}

async function refreshSession() {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include'
  })
  if (!res.ok) {
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  return res.json()
}

export async function api(path, options = {}) {
  const url = `${API_URL}${path}`

  const headers = { ...options.headers }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  })

  if (res.status === 401 && !path.startsWith('/auth/')) {
    await refreshSession()
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    })
    if (res.status === 401) {
      window.location.href = '/login'
      throw new Error('Session expired')
    }
  }

  if (res.headers.get('x-coingecko-rate-limited')) {
    showCoingeckoRateLimitToast()
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }

  if (res.status === 204) return null
  return res.json()
}
