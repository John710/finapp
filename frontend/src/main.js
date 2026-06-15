import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/main.css'
import Icon from './components/Icon.vue'
import i18n, { applyServerDefault } from './i18n'

import { useTheme } from './composables/useTheme.js'
import { logger } from './utils/logger.js'

useTheme()

async function fetchServerDefaultLanguage() {
  try {
    const res = await fetch('/api/v1/config/public')
    if (res.ok) {
      const cfg = await res.json()
      return cfg.defaultLanguage
    }
  } catch (e) {
    // ignore: offline or backend unavailable
  }
  return null
}

async function bootstrap() {
  const serverDefault = await fetchServerDefaultLanguage()
  if (serverDefault) {
    applyServerDefault(serverDefault)
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.use(i18n)
  app.component('Icon', Icon)
  app.mount('#app')

  // Register service worker for push notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        logger.log('[push] SW registered:', reg.scope, 'active:', !!reg.active)
        if (!reg.active) {
          logger.log('[push] SW not active yet, waiting...')
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            newWorker?.addEventListener('statechange', () => {
              logger.log('[push] SW state changed:', newWorker.state)
            })
          })
        }
      })
      .catch((err) => logger.warn('[push] SW registration failed:', err))
  } else {
    logger.warn('[push] ServiceWorker not supported in this browser')
  }
}

bootstrap()
