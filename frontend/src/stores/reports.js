import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

function buildQuery(params) {
  const filtered = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      filtered[key] = value
    }
  }
  // Auto-inject base currency from user settings
  if (!filtered.base_currency) {
    filtered.base_currency = localStorage.getItem('base_currency') || 'USD'
  }
  return new URLSearchParams(filtered).toString()
}

export const useReportsStore = defineStore('reports', () => {
  const summary = ref(null)
  const byCategory = ref([])
  const trend = ref([])
  const netWorth = ref([])
  const savingsRate = ref(null)
  const loading = ref(false)

  async function fetchSummary(params = {}) {
    const query = buildQuery(params)
    summary.value = await api(`/reports/summary?${query}`)
  }

  async function fetchByCategory(params = {}) {
    const query = buildQuery(params)
    byCategory.value = await api(`/reports/by-category?${query}`)
  }

  async function fetchTrend(params = {}) {
    const query = buildQuery(params)
    trend.value = await api(`/reports/trend?${query}`)
  }

  async function fetchNetWorth(params = {}) {
    const query = buildQuery(params)
    netWorth.value = await api(`/reports/net-worth?${query}`)
  }

  async function fetchSavingsRate(params = {}) {
    const query = buildQuery(params)
    savingsRate.value = await api(`/reports/savings-rate?${query}`)
  }

  async function exportCsv(params = {}) {
    const query = buildQuery(params)
    const res = await fetch(`/api/v1/export/csv?${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
    })
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finapp_export_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return { summary, byCategory, trend, netWorth, savingsRate, loading, fetchSummary, fetchByCategory, fetchTrend, fetchNetWorth, fetchSavingsRate, exportCsv }
})
