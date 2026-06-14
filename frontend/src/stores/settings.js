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

  return { generateVapidKeys, deleteVapidKeys, saveShoutrrrUrl }
})
