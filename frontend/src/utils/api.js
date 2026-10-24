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
  window.$toast?.warning?.(t('settings.coingecko_rate_limited'), 8000)
}

let refreshPromise = null

async function refreshSession() {
  // Deduplicate: many parallel requests can hit 401 at once (dashboard load),
  // but the refresh cookie is one-time use — a second concurrent refresh with
  // the already-consumed cookie would falsely log the user out and trip the
  // backend's replay protection.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      })
      if (!res.ok) {
        throw new Error('Session expired')
      }
      return res.json()
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
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
    try {
      await refreshSession()
    } catch {
      window.location.href = '/login'
      throw new Error('Session expired')
    }
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
    const e = new Error(err.error || `HTTP ${res.status}`)
    // Expose extra API flags (e.g. totp_required on login) to callers
    for (const key of Object.keys(err)) {
      if (key !== 'error') e[key] = err[key]
    }
    throw e
  }

  if (res.status === 204) return null
  return res.json()
}
