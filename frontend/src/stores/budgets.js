import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useBudgetsStore = defineStore('budgets', () => {
  const budgets = ref([])
  const loading = ref(false)

  async function fetchBudgets() {
    loading.value = true
    budgets.value = await api('/budgets')
    loading.value = false
  }

  async function createBudget(data) {
    const budget = await api('/budgets', { method: 'POST', body: JSON.stringify(data) })
    budgets.value.unshift(budget)
    return budget
  }

  async function updateBudget(id, data) {
    const budget = await api(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = budgets.value.findIndex(b => b.id === id)
    if (idx !== -1) budgets.value[idx] = budget
    return budget
  }

  async function deleteBudget(id) {
    await api(`/budgets/${id}`, { method: 'DELETE' })
    budgets.value = budgets.value.filter(b => b.id !== id)
  }

  return { budgets, loading, fetchBudgets, createBudget, updateBudget, deleteBudget }
})
