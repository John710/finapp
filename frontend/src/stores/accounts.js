import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref([])
  const loading = ref(false)

  async function fetchAccounts() {
    loading.value = true
    accounts.value = await api('/accounts')
    loading.value = false
  }

  async function createAccount(data) {
    const account = await api('/accounts', { method: 'POST', body: JSON.stringify(data) })
    accounts.value.unshift(account)
    return account
  }

  async function updateAccount(id, data) {
    const account = await api(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = accounts.value.findIndex(a => a.id === id)
    if (idx !== -1) accounts.value[idx] = account
    return account
  }

  async function deleteAccount(id) {
    await api(`/accounts/${id}`, { method: 'DELETE' })
    accounts.value = accounts.value.filter(a => a.id !== id)
  }

  async function reorderAccounts(orders) {
    await api('/accounts/reorder', { method: 'POST', body: JSON.stringify({ orders }) })
    // Update local state
    for (const item of orders) {
      const acc = accounts.value.find(a => a.id === item.id)
      if (acc) acc.sort_order = item.sort_order
    }
    // Re-sort to reflect new order
    accounts.value.sort((a, b) => {
      if (a.is_archived !== b.is_archived) return a.is_archived ? 1 : -1
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return (a.sort_order || 0) - (b.sort_order || 0)
    })
  }

  return { accounts, loading, fetchAccounts, createAccount, updateAccount, deleteAccount, reorderAccounts }
})
