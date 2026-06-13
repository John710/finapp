import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'
import { useRatesStore } from './rates'

function buildQuery(params) {
  const ratesStore = useRatesStore()
  const filtered = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      filtered[key] = value
    }
  }
  // Auto-inject base currency from user settings
  if (!filtered.base_currency) {
    filtered.base_currency = ratesStore.baseCurrency || localStorage.getItem('base_currency') || 'USD'
  }
  return new URLSearchParams(filtered).toString()
}

export const useReportsStore = defineStore('reports', () => {
  const summary = ref(null)
  const byCategory = ref([])
  const byCategoryAll = ref([])
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

  async function fetchByCategoryAll(params = {}) {
    const query = buildQuery(params)
    byCategoryAll.value = await api(`/reports/by-category?${query}`)
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
    const res = await fetch(`/api/v1/export/csv?${query}`, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finapp_export_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return { summary, byCategory, byCategoryAll, trend, netWorth, savingsRate, loading, fetchSummary, fetchByCategory, fetchByCategoryAll, fetchTrend, fetchNetWorth, fetchSavingsRate, exportCsv }
})
