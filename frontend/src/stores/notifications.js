import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/utils/api'

export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref([])
  const unreadCount = ref(0)
  const loading = ref(false)
  const filterType = ref('')

  async function fetchNotifications() {
    loading.value = true
    try {
      const typeParam = filterType.value ? `&type=${encodeURIComponent(filterType.value)}` : ''
      const data = await api(`/notifications?limit=20${typeParam}`)
      items.value = data.notifications || []
      unreadCount.value = data.unread_count || 0
    } finally {
      loading.value = false
    }
  }

  async function fetchUnreadCount() {
    try {
      const data = await api('/notifications/unread-count')
      unreadCount.value = data.count || 0
    } catch (e) {
      // ignore
    }
  }

  async function markRead(id) {
    await api(`/notifications/${id}/read`, { method: 'PATCH' })
    const n = items.value.find((x) => x.id === id)
    if (n && !n.is_read) {
      n.is_read = true
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
  }

  async function markAllRead() {
    await api('/notifications/read-all', { method: 'POST' })
    items.value.forEach((n) => (n.is_read = true))
    unreadCount.value = 0
  }

  async function remove(id) {
    await api(`/notifications/${id}`, { method: 'DELETE' })
    const idx = items.value.findIndex((x) => x.id === id)
    if (idx !== -1) {
      const wasUnread = !items.value[idx].is_read
      items.value.splice(idx, 1)
      if (wasUnread) unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
  }

  return { items, unreadCount, loading, filterType, fetchNotifications, fetchUnreadCount, markRead, markAllRead, remove }
})
