<template>
  <div>
    <!-- Gradient stat cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5 mb-5">
      <div class="rounded-3xl p-5 bg-gradient-to-br from-[#c9bef7] to-[#a18ff0] dark:from-[#4f439b] dark:to-[#3c327d] text-white shadow-card">
        <div class="flex items-start justify-between mb-6">
          <p class="text-sm text-white/80 font-medium">{{ $t('dashboard.total_balance') }}</p>
          <div class="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center">
            <Icon name="wallet" class="w-5 h-5" />
          </div>
        </div>
        <p class="font-display text-2xl font-semibold tracking-tight truncate">{{ formatCurrency(totalBalance) }}</p>
      </div>
      <div class="rounded-3xl p-5 bg-gradient-to-br from-[#fbd3b4] to-[#f2a488] dark:from-[#b06e3a] dark:to-[#8d5124] text-white shadow-card">
        <div class="flex items-start justify-between mb-6">
          <p class="text-sm text-white/80 font-medium">{{ $t('dashboard.income_month') }}</p>
          <div class="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center">
            <Icon name="money" class="w-5 h-5" />
          </div>
        </div>
        <p class="font-display text-2xl font-semibold tracking-tight truncate">+{{ formatCurrency(monthIncome) }}</p>
      </div>
      <div class="rounded-3xl p-5 bg-gradient-to-br from-[#b9d5f7] to-[#8fb9ef] dark:from-[#3e6ca6] dark:to-[#2e5382] text-white shadow-card">
        <div class="flex items-start justify-between mb-6">
          <p class="text-sm text-white/80 font-medium">{{ $t('dashboard.expense_month') }}</p>
          <div class="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center">
            <Icon name="arrowDown" class="w-5 h-5" />
          </div>
        </div>
        <p class="font-display text-2xl font-semibold tracking-tight truncate">−{{ formatCurrency(monthExpense) }}</p>
      </div>
      <div class="rounded-3xl p-5 bg-gradient-to-br from-[#bfe9d8] to-[#8fd4bc] dark:from-[#2f8168] dark:to-[#226250] text-white shadow-card">
        <div class="flex items-start justify-between mb-6">
          <p class="text-sm text-white/80 font-medium">{{ $t('dashboard.active_accounts') }}</p>
          <div class="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center">
            <Icon name="layers" class="w-5 h-5" />
          </div>
        </div>
        <p class="font-display text-2xl font-semibold tracking-tight">{{ accountsStore.accounts.length }}</p>
      </div>
    </div>

    <!-- Quick info cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-5 mb-6">
      <router-link to="/accounts" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark hover:shadow-float dark:hover:shadow-none transition-shadow flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-500/15 text-primary-600 dark:text-primary-400 flex items-center justify-center flex-shrink-0">
          <Icon name="money" class="w-6 h-6" />
        </div>
        <div class="min-w-0">
          <p class="text-xs text-slate-400 dark:text-slate-500 mb-0.5">{{ $t('dashboard.crypto_balance') }}</p>
          <p class="font-display font-semibold truncate">{{ formatCurrency(cryptoBalance) }}</p>
          <p class="text-xs text-slate-400 mt-0.5">{{ accountsStore.accounts.filter(a => a.type === 'crypto').length }} {{ $t('accounts.types.crypto') }}</p>
        </div>
      </router-link>
      <router-link to="/debts" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark hover:shadow-float dark:hover:shadow-none transition-shadow flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-500/15 text-rose-500 flex items-center justify-center flex-shrink-0">
          <Icon name="briefcase" class="w-6 h-6" />
        </div>
        <div class="min-w-0">
          <p class="text-xs text-slate-400 dark:text-slate-500 mb-0.5">{{ $t('dashboard.unpaid_debts') }}</p>
          <p class="font-display font-semibold truncate text-danger-500">{{ formatCurrency(unpaidDebtsTotal) }}</p>
          <p class="text-xs text-slate-400 mt-0.5">{{ debtsStore.debts.filter(d => d.status !== 'paid').length }} {{ $t('reports.unpaid') }}</p>
        </div>
      </router-link>
      <router-link to="/recurring" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark hover:shadow-float dark:hover:shadow-none transition-shadow flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-500/15 text-amber-500 flex items-center justify-center flex-shrink-0">
          <Icon name="repeat" class="w-6 h-6" />
        </div>
        <div class="min-w-0">
          <p class="text-xs text-slate-400 dark:text-slate-500 mb-0.5">{{ $t('dashboard.upcoming_recurring') }}</p>
          <p class="font-display font-semibold truncate text-primary-600 dark:text-primary-400">{{ upcomingRecurring.length }} — {{ formatCurrency(upcomingRecurringTotal) }}</p>
          <p class="text-xs text-slate-400 mt-0.5">≤ 5 {{ $t('common.days') }}</p>
        </div>
      </router-link>
    </div>

    <div v-if="accountsStore.accounts.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <div class="w-20 h-20 rounded-full bg-primary-100 dark:bg-primary-500/15 text-primary-500 flex items-center justify-center mx-auto mb-5">
        <Icon name="chart" class="w-9 h-9" />
      </div>
      <h3 class="font-display text-lg font-semibold mb-2">{{ $t('dashboard.no_data') }}</h3>
      <p class="text-slate-500 mb-5">{{ $t('dashboard.no_data_desc') }}</p>
      <router-link to="/transactions" class="inline-flex items-center px-5 py-2.5 bg-primary-500 hover:bg-primary-600 shadow-card text-white rounded-full text-sm font-semibold transition-colors">
        {{ $t('dashboard.add_transaction') }}
      </router-link>
    </div>

    <div v-else class="grid lg:grid-cols-2 gap-4 lg:gap-5">
      <!-- Trend chart -->
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 lg:p-6 shadow-card dark:shadow-card-dark">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-display font-semibold">{{ $t('dashboard.income_vs_expense') }}</h3>
          <div v-if="reportsStore.trend.length" class="flex gap-3 text-xs text-slate-400">
            <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-primary-500"></span>{{ $t('reports.income') }}</span>
            <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-[#b8c1ea]"></span>{{ $t('reports.expense') }}</span>
          </div>
        </div>
        <div v-if="reportsStore.trend.length" class="relative h-64">
          <BaseChart :option="trendChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Category chart -->
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 lg:p-6 shadow-card dark:shadow-card-dark">
        <h3 class="font-display font-semibold mb-1">{{ $t('dashboard.expenses_by_category') }}</h3>
        <div v-if="reportsStore.byCategory.filter(c => parseFloat(c.total) > 0).length" class="relative h-64">
          <BaseChart :option="categoryChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Net worth chart -->
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 lg:p-6 shadow-card dark:shadow-card-dark">
        <h3 class="font-display font-semibold mb-1">{{ $t('dashboard.net_worth') }}</h3>
        <div v-if="reportsStore.netWorth.length" class="relative h-64">
          <BaseChart :option="netWorthChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Savings rate -->
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 lg:p-6 shadow-card dark:shadow-card-dark">
        <h3 class="font-display font-semibold mb-1">{{ $t('dashboard.savings_rate') }}</h3>
        <div v-if="reportsStore.savingsRate" class="relative h-80">
          <BaseChart :option="savingsRateChartOption" :height="'280px'" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Recent transactions -->
      <div class="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
        <div class="px-5 lg:px-7 py-5 flex items-center justify-between">
          <h3 class="font-display font-semibold">{{ $t('transactions.title') }}</h3>
          <router-link to="/transactions" class="text-sm text-primary-500 hover:text-primary-600 font-medium">{{ $t('common.view_all') }} →</router-link>
        </div>
        <div class="divide-y divide-slate-100 dark:divide-slate-800">
          <div v-for="t in recentTransactions" :key="t.id" class="px-5 lg:px-7 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
            <div class="flex items-center gap-3.5 min-w-0">
              <div class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                :class="t.type === 'income' ? 'bg-primary-100 dark:bg-primary-500/15 text-primary-600 dark:text-primary-400' : t.type === 'transfer' ? 'bg-sky-100 dark:bg-sky-500/15 text-sky-500' : 'bg-rose-100 dark:bg-rose-500/15 text-rose-500'">
                <Icon :name="t.category_icon || 'money'" set="category" class="w-5 h-5" />
              </div>
              <div class="min-w-0">
                <p class="font-semibold text-sm truncate">{{ formatNote(t) || t.category_name || '-' }}</p>
                <p class="text-xs text-slate-400 mt-0.5">{{ formatDate(t.date) }} • {{ t.account_name }}</p>
              </div>
            </div>
            <span class="font-display font-semibold text-sm whitespace-nowrap ml-3" :class="t.type === 'income' ? 'text-primary-600 dark:text-primary-400' : t.type === 'expense' ? 'text-danger-500' : 'text-slate-600 dark:text-slate-300'">
              {{ t.type === 'income' ? '+' : (t.type === 'expense' ? '−' : '') }}{{ formatFull(t.amount, t.account_currency, baseCurrency.value, ratesStore.rates) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountsStore } from '../stores/accounts'
import { useTransactionsStore } from '../stores/transactions'
import { useReportsStore } from '../stores/reports'
import { useRatesStore } from '../stores/rates'
import { useDebtsStore } from '../stores/debts'
import { useRecurringStore } from '../stores/recurring'
import { formatFull } from '@/utils/currency'
import { getUserLocale } from '@/utils/locale'
import { formatCurrency as formatCurrencyValue, formatDate as formatDateValue } from '@/utils/format'
import { useDarkMode } from '@/composables/useDarkMode.js'
import { useTransactionDisplay } from '@/composables/useTransactionDisplay'
import { useChartOptions } from '@/composables/useChartOptions'
const BaseChart = defineAsyncComponent(() => import('@/components/BaseChart.vue'))

const { t } = useI18n()

const accountsStore = useAccountsStore()
const transactionsStore = useTransactionsStore()
const reportsStore = useReportsStore()
const ratesStore = useRatesStore()
const debtsStore = useDebtsStore()
const recurringStore = useRecurringStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)

const { isDark } = useDarkMode()
const { formatNote } = useTransactionDisplay(accountsStore)
const { trendChartOption: buildTrendOption, categoryChartOption: buildCategoryOption } = useChartOptions({ isDark, baseCurrency, ratesStore })

onMounted(async () => {
  accountsStore.fetchAccounts()
  transactionsStore.fetchTransactions({ limit: 5 })
  ratesStore.fetchRates()

  const now = new Date()
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('sv-SE')
  const monthTo = now.toLocaleDateString('sv-SE')
  reportsStore.fetchSummary({ from: monthFrom, to: monthTo })
  debtsStore.fetchDebts()
  recurringStore.fetchRules()

  // Fetch trend for last 6 months
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1).toLocaleDateString('sv-SE')
  const to = now.toLocaleDateString('sv-SE')
  reportsStore.fetchTrend({ from, to })
  reportsStore.fetchByCategory({ from, to, type: 'expense' })
  reportsStore.fetchNetWorth({ months: 12 })
  reportsStore.fetchSavingsRate({ from, to })
})

const totalBalance = computed(() => {
  return accountsStore.accounts.reduce((sum, a) => {
    const converted = ratesStore.convert(parseFloat(a.balance), a.currency, baseCurrency.value)
    return sum + (converted !== null ? converted : parseFloat(a.balance))
  }, 0)
})

const monthIncome = computed(() => {
  return reportsStore.summary ? parseFloat(reportsStore.summary.total_income) : 0
})

const monthExpense = computed(() => {
  return reportsStore.summary ? parseFloat(reportsStore.summary.total_expense) : 0
})

const cryptoBalance = computed(() => {
  return accountsStore.accounts
    .filter(a => a.type === 'crypto')
    .reduce((sum, a) => {
      const converted = ratesStore.convert(parseFloat(a.balance), a.currency, baseCurrency.value)
      return sum + (converted !== null ? converted : parseFloat(a.balance))
    }, 0)
})

const unpaidDebtsTotal = computed(() => {
  return debtsStore.debts
    .filter(d => d.status !== 'paid')
    .reduce((sum, d) => {
      const remaining = parseFloat(d.remaining) || 0
      const converted = ratesStore.convert(remaining, d.currency || baseCurrency.value, baseCurrency.value)
      return sum + (converted !== null ? converted : remaining)
    }, 0)
})

const upcomingRecurring = computed(() => {
  const now = new Date()
  const fiveDaysLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5)
  return recurringStore.rules.filter(r => {
    if (!r.is_active) return false
    const nextDate = new Date(r.next_date)
    return nextDate >= now && nextDate <= fiveDaysLater
  })
})

const upcomingRecurringTotal = computed(() => {
  return upcomingRecurring.value.reduce((sum, r) => {
    const amount = parseFloat(r.amount) || 0
    const converted = ratesStore.convert(amount, r.currency || baseCurrency.value, baseCurrency.value)
    return sum + (converted !== null ? converted : amount)
  }, 0)
})

const recentTransactions = computed(() => transactionsStore.transactions.slice(0, 5))

const trendChartOption = computed(() => buildTrendOption(reportsStore.trend))

const categoryChartOption = computed(() => buildCategoryOption(reportsStore.byCategory.filter(c => parseFloat(c.total) > 0)))

const netWorthChartOption = computed(() => {
  const values = reportsStore.netWorth.map(n => parseFloat(n.balance))

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark.value ? '#1e293b' : '#ffffff',
      borderColor: isDark.value ? '#334155' : '#eceaf6',
      textStyle: { color: isDark.value ? '#e2e8f0' : '#3f3d56' },
      formatter: (params) => {
        const p = params[0]
        return `${p.axisValue}<br/>${t('dashboard.net_worth')}: ${formatFull(p.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
      }
    },
    legend: { show: false },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: reportsStore.netWorth.map(n => n.month),
      axisLine: { lineStyle: { color: isDark.value ? '#334155' : '#eceaf6' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: isDark.value ? 'rgba(148,163,184,0.12)' : '#f1f1f7' } }
    },
    series: [
      {
        name: t('dashboard.net_worth'),
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: values,
        lineStyle: {
          color: '#7c6fde',
          width: 3
        },
        itemStyle: {
          color: '#7c6fde',
          borderColor: isDark.value ? '#0f172a' : '#ffffff',
          borderWidth: 2
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(124, 111, 222, 0.22)' },
              { offset: 1, color: 'rgba(124, 111, 222, 0.02)' }
            ]
          }
        }
      }
    ]
  }
})

const savingsRateChartOption = computed(() => {
  const savingsRate = reportsStore.savingsRate
  const rate = savingsRate?.rate || 0
  let color = '#34d399'
  let colorDark = '#10b981'
  if (rate < 10) {
    color = '#fb7185'
    colorDark = '#f43f5e'
  } else if (rate < 20) {
    color = '#fbbf24'
    colorDark = '#f59e0b'
  }

  // Data: only show savings rate as a percentage bar
  const data = [
    { value: Math.min(100, Math.max(0, rate)), name: t('dashboard.savings_rate'), color: color }
  ]

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: isDark.value ? '#1e293b' : '#ffffff',
      borderColor: isDark.value ? '#334155' : '#eceaf6',
      textStyle: { color: isDark.value ? '#e2e8f0' : '#3f3d56' },
      formatter: () => {
        return `${savingsRate ? formatFull(savingsRate.savings, baseCurrency.value, baseCurrency.value, ratesStore.rates) : '0'} (${rate.toFixed(1)}%)`
      }
    },
    grid: {
      left: 10,
      right: 10,
      bottom: 5,
      top: 5,
      containLabel: false
    },
    xAxis: {
      type: 'value',
      max: 100,
      show: true,
      axisLabel: {
        formatter: '{value}%',
        color: isDark.value ? '#94a3b8' : '#9ca0b5'
      },
      splitLine: {
        lineStyle: {
          color: isDark.value ? 'rgba(148,163,184,0.12)' : '#f1f1f7'
        }
      }
    },
    yAxis: {
      type: 'category',
      data: [''],
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    barWidth: '60%',
    series: [
      {
        name: 'Data',
        type: 'bar',
        data: data.map(d => d.value),
        barWidth: '60%',
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: color },
              { offset: 1, color: colorDark }
            ]
          },
          borderRadius: 999
        },
        label: {
          show: true,
          position: 'right',
          formatter: () => {
            return `${rate.toFixed(1)}%`
          },
          color: isDark.value ? '#f1f5f9' : '#3f3d56',
          fontSize: 14,
          fontWeight: 500,
          padding: [0, 0, 0, 8]
        }
      }
    ]
  }
})



function formatCurrency(value) {
  return formatCurrencyValue(value || 0, baseCurrency.value)
}

function formatDate(date) {
  return formatDateValue(date)
}
</script>
