import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRatesStore } from './rates'
import { api } from '@/utils/api.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const checked = ref(false)

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

  async function updateSettings(settings) {
    await api('/users/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    })
    if (user.value) {
      Object.assign(user.value, settings)
      if (settings.base_currency) {
        const ratesStore = useRatesStore()
        ratesStore.setBaseCurrency(settings.base_currency)
      }
    }
    return true
  }

  async function updateLanguage(language) {
    await updateSettings({ language })
    return true
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      window.location.href = '/login'
    }
  }

  return { user, checked, isAuthenticated, login, checkAuth, fetchMe, logout, updateSettings, updateLanguage }
})
