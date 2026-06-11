import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useDebtsStore = defineStore('debts', () => {
  const debts = ref([])
  const loading = ref(false)

  async function fetchDebts() {
    loading.value = true
    debts.value = await api('/debts')
    loading.value = false
  }

  async function createDebt(data) {
    const debt = await api('/debts', { method: 'POST', body: JSON.stringify(data) })
    debts.value.unshift(debt)
    return debt
  }

  async function updateDebt(id, data) {
    const debt = await api(`/debts/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = debts.value.findIndex(d => d.id === id)
    if (idx !== -1) debts.value[idx] = debt
    return debt
  }

  async function addPayment(id, data) {
    const payment = await api(`/debts/${id}/payments`, { method: 'POST', body: JSON.stringify(data) })
    await fetchDebts()
    return payment
  }

  async function getPayments(id) {
    return await api(`/debts/${id}/payments`)
  }

  async function deleteDebt(id) {
    await api(`/debts/${id}`, { method: 'DELETE' })
    debts.value = debts.value.filter(d => d.id !== id)
  }

  return { debts, loading, fetchDebts, createDebt, updateDebt, addPayment, getPayments, deleteDebt }
})
