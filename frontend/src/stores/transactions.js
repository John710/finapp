import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useTransactionsStore = defineStore('transactions', () => {
  const transactions = ref([])
  const total = ref(0)
  const loading = ref(false)

  async function fetchTransactions(params = {}) {
    loading.value = true
    const query = new URLSearchParams(params).toString()
    const data = await api(`/transactions?${query}`)
    transactions.value = data.items
    total.value = data.total
    loading.value = false
  }

  async function createTransaction(data) {
    const transaction = await api('/transactions', { method: 'POST', body: JSON.stringify(data) })
    transactions.value.unshift(transaction)
    total.value++
    return transaction
  }

  async function updateTransaction(id, data) {
    const transaction = await api(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = transactions.value.findIndex(t => t.id === id)
    if (idx !== -1) transactions.value[idx] = transaction
    return transaction
  }

  async function deleteTransaction(id) {
    await api(`/transactions/${id}`, { method: 'DELETE' })
    transactions.value = transactions.value.filter(t => t.id !== id)
    total.value--
  }

  return { transactions, total, loading, fetchTransactions, createTransaction, updateTransaction, deleteTransaction }
})
