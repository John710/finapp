import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useRecurringStore = defineStore('recurring', () => {
  const rules = ref([])
  const loading = ref(false)

  async function fetchRules() {
    loading.value = true
    rules.value = await api('/recurring')
    loading.value = false
  }

  async function createRule(data) {
    const rule = await api('/recurring', { method: 'POST', body: JSON.stringify(data) })
    rules.value.unshift(rule)
    return rule
  }

  async function updateRule(id, data) {
    const rule = await api(`/recurring/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = rules.value.findIndex(r => r.id === id)
    if (idx !== -1) rules.value[idx] = rule
    return rule
  }

  async function deleteRule(id) {
    await api(`/recurring/${id}`, { method: 'DELETE' })
    rules.value = rules.value.filter(r => r.id !== id)
  }

  return { rules, loading, fetchRules, createRule, updateRule, deleteRule }
})
