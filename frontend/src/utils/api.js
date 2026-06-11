const API_URL = '/api/v1'

const COINGECKO_TOAST_KEY = 'coingecko_rate_limit_toast'
const COINGECKO_TOAST_COOLDOWN = 5 * 60 * 1000 // 5 minutes

function showCoingeckoRateLimitToast() {
  const lastShown = parseInt(localStorage.getItem(COINGECKO_TOAST_KEY) || '0', 10)
  const now = Date.now()
  if (now - lastShown < COINGECKO_TOAST_COOLDOWN) return
  localStorage.setItem(COINGECKO_TOAST_KEY, String(now))
  window.$toast?.warning?.(
    'CoinGecko недоступен (лимит запросов). Добавьте свой API ключ в Настройки → CoinGecko API Key для стабильной работы.',
    { duration: 8000 }
  )
}

async function refreshToken() {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include'
  })
  if (!res.ok) {
    localStorage.removeItem('accessToken')
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  const data = await res.json()
  localStorage.setItem('accessToken', data.accessToken)
  return data.accessToken
}

export async function api(path, options = {}) {
  const url = `${API_URL}${path}`
  const token = localStorage.getItem('accessToken')

  const headers = { ...options.headers }
  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  })

  if (res.status === 401 && token) {
    const newToken = await refreshToken()
    headers.Authorization = `Bearer ${newToken}`
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    })
  }

  // Check CoinGecko rate limit header on any successful response
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
