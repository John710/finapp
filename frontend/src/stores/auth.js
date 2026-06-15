import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRatesStore } from './rates'
import { api } from '@/utils/api.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const checked = ref(false)
  const setupChecked = ref(false)
  const setupRequired = ref(false)

  const isAuthenticated = computed(() => !!user.value)

  async function login(login, password) {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    })
    user.value = data.user
    if (data.user?.language) {
      localStorage.setItem('lang', data.user.language)
    }
    if (data.user?.base_currency) {
      const ratesStore = useRatesStore()
      ratesStore.setBaseCurrency(data.user.base_currency)
    }
    return data
  }

  async function checkAuth() {
    checked.value = true
    try {
      const data = await api('/auth/refresh', { method: 'POST' })
      user.value = data.user
      if (data.user?.language) {
        localStorage.setItem('lang', data.user.language)
      }
    } catch {
      user.value = null
    }
  }

  async function fetchMe() {
    const data = await api('/users/me')
    user.value = data
    return data
  }

  async function checkSetup() {
    if (setupChecked.value) return setupRequired.value
    try {
      const res = await fetch('/api/v1/auth/setup-required')
      if (res.ok) {
        const data = await res.json()
        setupRequired.value = data.required
      }
    } catch (e) {
      // ignore
    } finally {
      setupChecked.value = true
    }
    return setupRequired.value
  }

  async function updateSettings(settings) {
    await api('/users/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    })
    await fetchMe()
    if (user.value && settings.base_currency) {
      const ratesStore = useRatesStore()
      ratesStore.setBaseCurrency(settings.base_currency)
    }
    return true
  }

  async function updateLanguage(language) {
    await updateSettings({ language })
    return true
  }

  async function logout() {
    try {
      await api('/users/logout', { method: 'POST' })
    } finally {
      user.value = null
      window.location.href = '/login'
    }
  }

  return { user, checked, setupChecked, setupRequired, isAuthenticated, login, checkAuth, fetchMe, logout, updateSettings, updateLanguage, checkSetup }
})
