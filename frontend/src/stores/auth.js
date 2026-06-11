import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRatesStore } from './rates'

const API_URL = '/api/v1'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(localStorage.getItem('accessToken') || null)
  const checked = ref(false)

  const isAuthenticated = computed(() => !!token.value)

  async function login(login, password) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password })
    })
    if (!res.ok) throw new Error('Invalid credentials')
    const data = await res.json()
    token.value = data.accessToken
    localStorage.setItem('accessToken', data.accessToken)
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
    if (!token.value) return
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      })
      if (!res.ok) {
        token.value = null
        localStorage.removeItem('accessToken')
        return
      }
      const data = await res.json()
      token.value = data.accessToken
      localStorage.setItem('accessToken', data.accessToken)
      if (data.user?.language) {
        user.value = data.user
        localStorage.setItem('lang', data.user.language)
      }
    } catch {
      token.value = null
      localStorage.removeItem('accessToken')
    }
  }

  async function fetchMe() {
    if (!token.value) return
    const res = await fetch(`${API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token.value}` }
    })
    if (!res.ok) return
    const data = await res.json()
    user.value = data
    return data
  }

  async function updateSettings(settings) {
    const res = await fetch(`${API_URL}/users/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify(settings)
    })
    if (!res.ok) throw new Error('Failed to update settings')
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
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token.value}` }
    })
    token.value = null
    user.value = null
    localStorage.removeItem('accessToken')
  }

  return { user, token, checked, isAuthenticated, login, checkAuth, fetchMe, logout, updateSettings, updateLanguage }
})
