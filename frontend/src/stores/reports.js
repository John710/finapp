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
  const recurringPlan = ref(null)
  const dashboard = ref(null)
  const loading = ref(false)

  // One aggregate payload for the dashboard (accounts, month summary, trend,
  // net worth, recent transactions, upcoming recurring, debts summary)
  async function fetchDashboard(params = {}) {
    const query = buildQuery(params)
    const data = await api(`/reports/dashboard?${query}`)
    dashboard.value = data
    // Hydrate the pieces other computeds already read
    trend.value = data.trend
    netWorth.value = data.net_worth
    summary.value = {
      total_income: data.month_summary.income,
      total_expense: data.month_summary.expense,
      total_transfer: 0,
      net: data.month_summary.net,
      count: null,
      unconverted_count: 0,
      base_currency: data.base_currency
    }
    return data
  }

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

  // Monthly plan (what the schedules ask for) vs actual (what the ledger booked)
  async function fetchRecurringPlan(params = {}) {
    const query = buildQuery(params)
    recurringPlan.value = await api(`/reports/recurring-plan?${query}`)
  }

  async function exportCsv(params = {}) {
    const query = buildQuery(params)
    // Through api(): 401 refresh and localized errors, like every other call
    const blob = await api(`/export/csv?${query}`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Local calendar day (toISOString would shift it to UTC)
    a.download = `finapp_export_${new Date().toLocaleDateString('sv-SE')}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return { summary, byCategory, byCategoryAll, trend, netWorth, savingsRate, recurringPlan, dashboard, loading, fetchDashboard, fetchSummary, fetchByCategory, fetchByCategoryAll, fetchTrend, fetchNetWorth, fetchSavingsRate, fetchRecurringPlan, exportCsv }
})
