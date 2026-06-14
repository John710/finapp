import { defineStore } from 'pinia'
import { api } from '@/utils/api.js'

export const useSettingsStore = defineStore('settings', () => {
  async function generateVapidKeys(subject) {
    return api('/admin/generate-vapid-keys', {
      method: 'POST',
      body: JSON.stringify({ subject })
    })
  }

  async function deleteVapidKeys() {
    return api('/admin/delete-vapid-keys', { method: 'POST' })
  }

  async function saveShoutrrrUrl(url) {
    return api('/users/settings', {
      method: 'PATCH',
      body: JSON.stringify({ shoutrrr_url: url || null })
    })
  }

  async function testCoingeckoKey(key) {
    return api('/users/test-coingecko-key', {
      method: 'POST',
      body: JSON.stringify({ coingecko_api_key: key })
    })
  }

  async function changePassword(current_password, new_password) {
    return api('/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password })
    })
  }

  async function fetchSessions() {
    return api('/users/sessions')
  }

  async function terminateSession(sessionId) {
    return api(`/users/sessions/${sessionId}`, { method: 'DELETE' })
  }

  async function logoutAllSessions() {
    return api('/users/logout-all', { method: 'POST' })
  }

  return {
    generateVapidKeys,
    deleteVapidKeys,
    saveShoutrrrUrl,
    testCoingeckoKey,
    changePassword,
    fetchSessions,
    terminateSession,
    logoutAllSessions
  }
})
