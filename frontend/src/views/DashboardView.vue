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
        <div v-if="trendData.labels.length" class="relative h-64">
          <Bar :data="trendData" :options="chartOptions" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Category chart -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.expenses_by_category') }}</h3>
        <div v-if="categoryData.labels.length" class="relative h-64">
          <Doughnut :data="categoryData" :options="chartOptions" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Net worth chart -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.net_worth') }}</h3>
        <div v-if="netWorthData.labels.length" class="relative h-64">
          <Line :data="netWorthData" :options="lineChartOptions" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Savings rate -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('dashboard.savings_rate') }}</h3>
        <div v-if="reportsStore.savingsRate" class="flex flex-col items-center justify-center h-64">
          <div class="relative h-40 w-40">
            <Doughnut :data="savingsRateData" :options="doughnutOptions" />
          </div>
          <p class="text-2xl font-bold mt-4" :class="savingsRateColor">{{ reportsStore.savingsRate.rate }}%</p>
          <p class="text-sm text-slate-500">{{ $t('dashboard.savings_rate_desc') }}</p>
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
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountsStore } from '../stores/accounts'
import { useTransactionsStore } from '../stores/transactions'
import { useReportsStore } from '../stores/reports'
import { useRatesStore } from '../stores/rates'
import { useDebtsStore } from '../stores/debts'
import { useRecurringStore } from '../stores/recurring'
import { formatFull } from '@/utils/currency'

const { t } = useI18n()
import { Bar, Doughnut, Line } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Filler } from 'chart.js'

ChartJS.register(Title, Tooltip, Legend, BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Filler)

const accountsStore = useAccountsStore()
const transactionsStore = useTransactionsStore()
const reportsStore = useReportsStore()
const ratesStore = useRatesStore()
const debtsStore = useDebtsStore()
const recurringStore = useRecurringStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)

onMounted(async () => {
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

const trendData = computed(() => {
  const labels = reportsStore.trend.map(t => t.month)
  return {
    labels,
    datasets: [
      {
        label: t('reports.income'),
        data: reportsStore.trend.map(t => t.income),
        backgroundColor: '#10b981',
        borderRadius: 4
      },
      {
        label: t('reports.expense'),
        data: reportsStore.trend.map(t => t.expense),
        backgroundColor: '#f43f5e',
        borderRadius: 4
      },
      {
        label: t('transactions.types.transfer'),
        data: reportsStore.trend.map(t => t.transfer || 0),
        backgroundColor: '#3b82f6',
        borderRadius: 4
      }
    ]
  }
})

const categoryData = computed(() => {
  const items = reportsStore.byCategory.filter(c => parseFloat(c.total) > 0)
  return {
    labels: items.map(c => c.name),
    datasets: [{
      data: items.map(c => c.total),
      backgroundColor: items.map(c => c.color || '#94a3b8'),
      borderWidth: 0
    }]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: { usePointStyle: true, padding: 20 }
    }
  },
  scales: {
    x: { grid: { display: false } },
    y: { grid: { color: '#e2e8f0' }, border: { display: false } }
  }
}

const lineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false }
  },
  scales: {
    x: { grid: { display: false } },
    y: { grid: { color: '#e2e8f0' }, border: { display: false } }
  },
  interaction: { intersect: false, mode: 'index' }
}

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '75%',
  plugins: { legend: { display: false }, tooltip: { enabled: false } }
}

const netWorthData = computed(() => {
  const labels = reportsStore.netWorth.map(n => n.month)
  return {
    labels,
    datasets: [{
      label: t('dashboard.net_worth'),
      data: reportsStore.netWorth.map(n => n.balance),
      borderColor: '#0f766e',
      backgroundColor: 'rgba(15, 118, 110, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointBackgroundColor: '#0f766e'
    }]
  }
})

const savingsRateData = computed(() => {
  const rate = reportsStore.savingsRate?.rate || 0
  return {
    labels: [t('dashboard.saved'), t('dashboard.spent')],
    datasets: [{
      data: [Math.max(0, rate), Math.max(0, 100 - rate)],
      backgroundColor: ['#10b981', '#f43f5e'],
      borderWidth: 0
    }]
  }
})

const savingsRateColor = computed(() => {
  const rate = reportsStore.savingsRate?.rate || 0
  if (rate >= 20) return 'text-primary-600'
  if (rate >= 10) return 'text-yellow-500'
  return 'text-danger-500'
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
