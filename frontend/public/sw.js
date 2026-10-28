/* FinApp service worker: push notifications + offline app shell.
   API calls are never cached (financial data must be fresh); only the SPA
   shell and static assets are stored so the UI opens offline. */

const SHELL_CACHE = 'finapp-shell-v1'
const ASSET_CACHE = 'finapp-assets-v1'
const SHELL_URLS = ['/', '/index.html', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never intercept the API or cross-origin traffic
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // SPA navigations: network first, fall back to the cached shell offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // Only a healthy response may become the offline shell: caching a
          // 5xx/404 page would serve that error to the user while offline
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    )
    return
  }

  // Hashed build assets and fonts: stale-while-revalidate
  if (url.pathname.startsWith('/assets/') || /\.(js|css|woff2?|png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || network
      })
    )
  }
})

function readPushPayload(event) {
  try {
    return event.data?.json() || {}
  } catch {
    return {}
  }
}

self.addEventListener('push', (event) => {
  // A push may carry no payload or non-JSON text: fall back to the defaults
  // instead of throwing and showing nothing
  const data = readPushPayload(event)
  event.waitUntil(
    self.registration.showNotification(data.title || 'FinApp', {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: data.data || {}
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})
