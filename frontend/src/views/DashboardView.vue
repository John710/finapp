<template>
  <div>
    <!-- Stats cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      <div class="bg-white dark:bg-slate-900 rounded-xl p-4 lg:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.total_balance') }}</p>
        <p class="text-xl lg:text-2xl font-bold text-slate-900 dark:text-white">{{ formatCurrency(totalBalance) }}</p>
      </div>
      <div class="bg-white dark:bg-slate-900 rounded-xl p-4 lg:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.income_month') }}</p>
        <p class="text-xl lg:text-2xl font-bold text-primary-600">+{{ formatCurrency(monthIncome) }}</p>
      </div>
      <div class="bg-white dark:bg-slate-900 rounded-xl p-4 lg:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.expense_month') }}</p>
        <p class="text-xl lg:text-2xl font-bold text-danger-500">−{{ formatCurrency(monthExpense) }}</p>
      </div>
      <div class="bg-white dark:bg-slate-900 rounded-xl p-4 lg:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.active_accounts') }}</p>
        <p class="text-xl lg:text-2xl font-bold text-slate-900 dark:text-white">{{ accountsStore.accounts.length }}</p>
      </div>
    </div>

    <!-- Quick info cards -->
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      <router-link to="/accounts" class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.crypto_balance') }}</p>
        <p class="text-lg font-bold text-slate-900 dark:text-white">{{ formatCurrency(cryptoBalance) }}</p>
        <p class="text-xs text-slate-400 mt-1">{{ accountsStore.accounts.filter(a => a.type === 'crypto').length }} {{ $t('accounts.types.crypto') }}</p>
      </router-link>
      <router-link to="/debts" class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.unpaid_debts') }}</p>
        <p class="text-lg font-bold text-danger-500">{{ formatCurrency(unpaidDebtsTotal) }}</p>
        <p class="text-xs text-slate-400 mt-1">{{ debtsStore.debts.filter(d => d.status !== 'paid').length }} {{ $t('reports.unpaid') }}</p>
      </router-link>
      <router-link to="/recurring" class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">{{ $t('dashboard.upcoming_recurring') }}</p>
        <p class="text-lg font-bold text-primary-600">{{ upcomingRecurring.length }} — {{ formatCurrency(upcomingRecurringTotal) }}</p>
        <p class="text-xs text-slate-400 mt-1">≤ 5 {{ $t('recurring.frequencies.daily') === 'Ежедневно' ? 'дней' : 'days' }}</p>
      </router-link>
    </div>

    <div v-if="accountsStore.accounts.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
        <Icon name="chart" class="w-8 h-8 text-slate-400" />
      </div>
      <h3 class="text-lg font-semibold mb-2">{{ $t('dashboard.no_data') }}</h3>
      <p class="text-slate-500 mb-4">{{ $t('dashboard.no_data_desc') }}</p>
      <router-link to="/transactions" class="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors">
        {{ $t('dashboard.add_transaction') }}
      </router-link>
    </div>

    <div v-else class="grid lg:grid-cols-2 gap-6">
      <!-- Trend chart -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.income_vs_expense') }}</h3>
        <div v-if="reportsStore.trend.length" class="relative h-64">
          <BaseChart :option="trendChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Category chart -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.expenses_by_category') }}</h3>
        <div v-if="reportsStore.byCategory.filter(c => parseFloat(c.total) > 0).length" class="relative h-64">
          <BaseChart :option="categoryChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Net worth chart -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.net_worth') }}</h3>
        <div v-if="reportsStore.netWorth.length" class="relative h-64">
          <BaseChart :option="netWorthChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Savings rate -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.savings_rate') }}</h3>
        <div v-if="reportsStore.savingsRate" class="relative h-80">
          <BaseChart :option="savingsRateChartOption" :height="'280px'" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Recent transactions -->
      <div class="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 class="font-semibold">{{ $t('transactions.title') }}</h3>
          <router-link to="/transactions" class="text-sm text-primary-600 hover:text-primary-700 font-medium">{{ $t('common.view_all') }} →</router-link>
        </div>
        <div class="divide-y divide-slate-100 dark:divide-slate-800">
          <div v-for="t in recentTransactions" :key="t.id" class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium" :class="t.type === 'income' ? 'bg-primary-100 text-primary-600' : 'bg-danger-100 text-danger-600'">
                {{ t.type === 'income' ? '+' : '−' }}
              </div>
              <div>
                <p class="font-medium text-sm">{{ formatNote(t.note) || t.category_name || '-' }}</p>
                <p class="text-xs text-slate-500">{{ formatDate(t.date) }} • {{ t.account_name }}</p>
              </div>
            </div>
            <span class="font-medium text-sm" :class="t.type === 'income' ? 'text-primary-600' : 'text-danger-500'">
              {{ t.type === 'income' ? '+' : '−' }}{{ formatFull(t.amount, t.account_currency, baseCurrency.value, ratesStore.rates) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountsStore } from '../stores/accounts'
import { useTransactionsStore } from '../stores/transactions'
import { useReportsStore } from '../stores/reports'
import { useRatesStore } from '../stores/rates'
import { useDebtsStore } from '../stores/debts'
import { useRecurringStore } from '../stores/recurring'
import { formatFull } from '@/utils/currency'
import BaseChart from '@/components/BaseChart.vue'

const { t } = useI18n()

const accountsStore = useAccountsStore()
const transactionsStore = useTransactionsStore()
const reportsStore = useReportsStore()
const ratesStore = useRatesStore()
const debtsStore = useDebtsStore()
const recurringStore = useRecurringStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)

const isDark = ref(document.documentElement.classList.contains('dark'))

onMounted(async () => {
  const observer = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })

  accountsStore.fetchAccounts()
  transactionsStore.fetchTransactions({ limit: 5 })
  ratesStore.fetchRates()
  debtsStore.fetchDebts()
  recurringStore.fetchRules()

  // Fetch trend for last 6 months
  const now = new Date()
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
  return transactionsStore.transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => {
      const converted = ratesStore.convert(parseFloat(t.amount), t.account_currency || baseCurrency.value, baseCurrency.value)
      return sum + (converted !== null ? converted : parseFloat(t.amount))
    }, 0)
})

const monthExpense = computed(() => {
  return transactionsStore.transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => {
      const converted = ratesStore.convert(parseFloat(t.amount), t.account_currency || baseCurrency.value, baseCurrency.value)
      return sum + (converted !== null ? converted : parseFloat(t.amount))
    }, 0)
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

const trendChartOption = computed(() => {
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        let result = params[0].axisValue + '<br/>'
        params.forEach(p => {
          result += `${p.marker} ${p.seriesName}: ${formatFull(p.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}<br/>`
        })
        return result
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
      data: reportsStore.trend.map(t => t.month)
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        name: t('reports.income'),
        type: 'bar',
        data: reportsStore.trend.map(t => t.income),
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#10b981' },
              { offset: 1, color: '#059669' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        }
      },
      {
        name: t('reports.expense'),
        type: 'bar',
        data: reportsStore.trend.map(t => t.expense),
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#f43f5e' },
              { offset: 1, color: '#dc2626' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        }
      },
      {
        name: t('transactions.types.transfer'),
        type: 'bar',
        data: reportsStore.trend.map(t => t.transfer || 0),
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#3b82f6' },
              { offset: 1, color: '#2563eb' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        }
      }
    ]
  }
})

const categoryChartOption = computed(() => {
  const items = reportsStore.byCategory.filter(c => parseFloat(c.total) > 0)
  return {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        return `${params.marker} ${params.name}: ${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)} (${params.percent}%)`
      }
    },
    legend: { show: false },
    series: [
      {
        name: t('categories.title'),
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: 'transparent',
          borderWidth: 0
        },
        label: {
          show: true,
          formatter: '{b}: {d}%',
          fontSize: 11
        },
        emphasis: {
          scale: true,
          scaleSize: 10,
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold'
          }
        },
        data: items.map(c => ({
          value: parseFloat(c.total),
          name: c.name,
          itemStyle: { color: c.color || '#94a3b8' }
        }))
      }
    ]
  }
})

const netWorthChartOption = computed(() => {
  return {
    tooltip: {
      trigger: 'axis',
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
      data: reportsStore.netWorth.map(n => n.month)
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        name: t('dashboard.net_worth'),
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: reportsStore.netWorth.map(n => n.balance),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(15, 118, 110, 0.3)' },
              { offset: 1, color: 'rgba(15, 118, 110, 0.05)' }
            ]
          }
        },
        lineStyle: {
          color: '#0f766e',
          width: 2
        },
        itemStyle: {
          color: '#0f766e'
        }
      }
    ]
  }
})

const savingsRateChartOption = computed(() => {
  const savingsRate = reportsStore.savingsRate
  const rate = savingsRate?.rate || 0
  let color = '#10b981'
  if (rate < 10) color = '#f43f5e'
  else if (rate < 20) color = '#f59e0b'

  // Data: only show savings rate as a percentage bar
  const data = [
    { value: Math.min(100, Math.max(0, rate)), name: t('dashboard.savings_rate'), color: color }
  ]

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0]
        return `${p.marker} ${p.name}: ${savingsRate ? formatFull(savingsRate.savings, baseCurrency.value, baseCurrency.value, ratesStore.rates) : '0'} (${rate.toFixed(1)}%)`
      }
    },
    grid: {
      left: 0,
      right: 10,
      bottom: 5,
      top: 5,
      containLabel: true
    },
    xAxis: {
      type: 'value',
      max: 100,
      show: true,
      axisLabel: {
        formatter: '{value}%',
        color: isDark.value ? '#94a3b8' : '#64748b'
      },
      splitLine: {
        lineStyle: {
          color: isDark.value ? 'rgba(148,163,184,0.1)' : 'rgba(100,116,139,0.1)'
        }
      }
    },
    yAxis: {
      type: 'category',
      data: data.map(d => d.name),
      axisLabel: {
        color: isDark.value ? '#f1f5f9' : '#1e293b',
        fontSize: 14,
        fontWeight: 500,
        margin: 10
      },
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
              { offset: 1, color: color === '#10b981' ? '#059669' : color === '#f43f5e' ? '#dc2626' : '#d97706' }
            ]
          },
          borderRadius: 10
        },
        label: {
          show: true,
          position: 'right',
          formatter: () => {
            return `${rate.toFixed(1)}%`
          },
          color: isDark.value ? '#f1f5f9' : '#1e293b',
          fontSize: 14,
          fontWeight: 500,
          padding: [0, 0, 0, 8]
        }
      }
    ]
  }
})



function formatCurrency(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: baseCurrency.value }).format(value || 0)
}

function formatNote(note) {
  if (!note) return ''
  return note
    .replace(/^Debt created:\s*/, t('debts.tx_created') + ': ')
    .replace(/^debt_created:\s*/, t('debts.tx_created') + ': ')
    .replace(/^Debt payment:\s*/, t('debts.tx_payment') + ': ')
    .replace(/^debt_payment:\s*/, t('debts.tx_payment') + ': ')
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('ru-RU')
}
</script>
