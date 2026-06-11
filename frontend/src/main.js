import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import router from './router'
import App from './App.vue'
import './assets/main.css'
import Icon from './components/Icon.vue'

import en from './locales/en.json'
import ru from './locales/ru.json'

const savedLang = localStorage.getItem('lang') || (navigator.language.startsWith('ru') ? 'ru' : 'en')
const savedTheme = localStorage.getItem('theme') || 'auto'

function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }
}

applyTheme(savedTheme)

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (localStorage.getItem('theme') === 'auto') {
    if (e.matches) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }
})

const i18n = createI18n({
  locale: savedLang,
  fallbackLocale: 'en',
  messages: { en, ru }
})

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
      console.log('[push] SW registered:', reg.scope, 'active:', !!reg.active)
      if (!reg.active) {
        console.log('[push] SW not active yet, waiting...')
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          newWorker?.addEventListener('statechange', () => {
            console.log('[push] SW state changed:', newWorker.state)
          })
        })
      }
    })
    .catch((err) => console.warn('[push] SW registration failed:', err))
} else {
  console.warn('[push] ServiceWorker not supported in this browser')
}
