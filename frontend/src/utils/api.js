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
// Once a refresh attempt fails, every queued 401'd request would otherwise
// fire its own retry and hammer the auth rate limit while the redirect to
// /login is still pending. The latch stops that storm until the next full
// page load (the login page clears it on successful login).
let refreshDead = false

export function clearRefreshDead() {
  refreshDead = false
}

// Full reload to /login, remembering where the user was so login can return
// them there (LoginView reads ?redirect=).
function redirectToLogin() {
  const { pathname, search } = window.location
  const onAuthPage = pathname === '/login' || pathname === '/register'
  const here = `${pathname}${search}`
  window.location.href = onAuthPage || here === '/'
    ? '/login'
    : `/login?redirect=${encodeURIComponent(here)}`
}

async function refreshSession() {
  // Deduplicate: many parallel requests can hit 401 at once (dashboard load),
  // but the refresh cookie is one-time use — a second concurrent refresh with
  // the already-consumed cookie would falsely log the user out and trip the
  // backend's replay protection.
  if (refreshDead) {
    throw new Error(t('errors.session_expired'))
  }
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      })
      if (!res.ok) {
        refreshDead = true
        throw new Error(t('errors.session_expired'))
      }
      return res.json()
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

// `options.responseType === 'blob'` returns the response body as a Blob (file
// downloads) instead of parsing JSON; everything else is passed to fetch.
export async function api(path, options = {}) {
  const { responseType, ...fetchOptions } = options
  options = fetchOptions
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
    // A dead refresh leaves no store able to recover in-app, so a full reload is intentional.
    try {
      await refreshSession()
    } catch {
      redirectToLogin()
      throw new Error(t('errors.session_expired'))
    }
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    })
    if (res.status === 401) {
      redirectToLogin()
      throw new Error(t('errors.session_expired'))
    }
  }

  if (res.headers.get('x-coingecko-rate-limited')) {
    showCoingeckoRateLimitToast()
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // Rate-limit rejections arrive as raw framework messages — surface a
    // localized, actionable error instead of the English default
    if (res.status === 429 || err.statusCode === 429) {
      throw new Error(t('errors.rate_limited'))
    }
    const e = new Error(err.error || t('errors.http_status', { status: res.status }))
    // Expose extra API flags (e.g. totp_required on login) to callers
    for (const key of Object.keys(err)) {
      if (key !== 'error') e[key] = err[key]
    }
    throw e
  }

  if (res.status === 204) return null
  if (responseType === 'blob') return res.blob()
  return res.json()
}
