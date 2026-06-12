  <template>
    <div>
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <h1 class="text-2xl font-bold">{{ $t('reports.title') }}</h1>
        <button @click="exportData" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors self-start">
          <Icon name="upload" class="w-4 h-4" />
          {{ $t('reports.export_csv') }}
        </button>
      </div>

      <!-- Filters -->
      <div class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-6 flex flex-wrap gap-3 items-center">
        <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button v-for="p in periodOptions" :key="p.value" @click="setPeriod(p.value)"
            class="px-3 py-2 rounded-md text-sm font-medium transition-colors"
            :class="selectedPeriod === p.value ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'">
            {{ p.label }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-slate-500">{{ $t('reports.from') }}</label>
          <input v-model="filters.from" type="date" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-slate-500">{{ $t('reports.to') }}</label>
          <input v-model="filters.to" type="date" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
        </div>
        <button @click="applyFilters" :disabled="loading" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
          {{ loading ? $t('common.loading') + '...' : $t('reports.apply') }}
        </button>
      </div>

      <!-- Summary cards -->
      <div v-if="reportsStore.summary" class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_income') }}</p>
          <p class="text-xl font-bold text-primary-600">+{{ formatCurrency(reportsStore.summary.total_income) }}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_expense') }}</p>
          <p class="text-xl font-bold text-danger-500">−{{ formatCurrency(reportsStore.summary.total_expense) }}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_transfer') }}</p>
          <p class="text-xl font-bold text-blue-500">{{ formatCurrency(reportsStore.summary.total_transfer || 0) }}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.net') }}</p>
          <p class="text-xl font-bold" :class="net >= 0 ? 'text-primary-600' : 'text-danger-500'">{{ net >= 0 ? '+' : '' }}{{ formatCurrency(net) }}</p>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-6">
        <!-- Trend chart -->
        <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h3 class="font-semibold mb-4">{{ $t('reports.monthly_trend') }}</h3>
          <div v-if="reportsStore.trend.length" class="relative h-64">
            <BaseChart :option="trendChartOption" />
          </div>
          <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
        </div>

        <!-- Category chart -->
        <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">{{ categoryType === 'income' ? $t('reports.income_by_category') : $t('reports.expenses_by_category') }}</h3>
            <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button v-for="t in ['expense', 'income']" :key="t" @click="categoryType = t; applyFilters()"
                class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                :class="categoryType === t ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'">
                {{ $t('categories.types.' + t) }}
              </button>
            </div>
          </div>
          <div v-if="reportsStore.byCategory.filter(c => parseFloat(c.total) > 0).length" class="relative h-64">
            <BaseChart :option="categoryChartOption" />
          </div>
          <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
        </div>
      </div>

      <!-- Sankey chart -->
      <div v-if="sankeyData.links.length" class="mt-6 bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="font-semibold mb-4">{{ $t('reports.cash_flow') || 'Cash Flow' }}</h3>
        <div class="relative h-[400px]">
          <BaseChart :option="sankeyChartOption" :height="'400px'" />
        </div>
      </div>

      <!-- Category table -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="font-semibold">{{ $t('reports.by_category') }}</h3>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.count') }}</th>
              <th class="text-right px-5 py-3 font-medium">%</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="cat in reportsStore.byCategory" :key="cat.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: cat.color || '#94a3b8' }"></div>
                  {{ cat.name || $t('categories.uncategorized') }}
                </div>
              </td>
              <td class="px-5 py-3 text-right font-medium">{{ formatCurrency(cat.total) }}</td>
              <td class="px-5 py-3 text-right">{{ cat.count }}</td>
              <td class="px-5 py-3 text-right">
                <div class="flex items-center justify-end gap-2">
                  <div class="w-16 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div class="h-full rounded-full" :style="{ width: categoryPercent(cat.total) + '%', backgroundColor: cat.color || '#94a3b8' }"></div>
                  </div>
                  <span class="text-xs">{{ categoryPercent(cat.total) }}%</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Crypto Holdings -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 class="font-semibold">{{ $t('reports.crypto_holdings') }}</h3>
          <span v-if="cryptoAccounts.length" class="text-sm font-bold text-slate-900 dark:text-white">{{ formatCurrency(cryptoTotalValue) }}</span>
        </div>
        <div v-if="!cryptoAccounts.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('common.name') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.balance') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.value') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="acc in cryptoAccounts" :key="acc.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: acc.color || '#94a3b8' }"></div>
                  {{ acc.name }}
                  <span class="text-xs text-slate-400">{{ acc.currency }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-right font-medium">{{ parseFloat(acc.balance).toLocaleString('ru-RU', { maximumFractionDigits: 8 }) }}</td>
              <td class="px-5 py-3 text-right font-medium">{{ formatCurrency(ratesStore.convert(parseFloat(acc.balance), acc.currency, baseCurrency.value) ?? parseFloat(acc.balance)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Budgets -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="font-semibold">{{ $t('reports.budgets') }}</h3>
        </div>
        <div v-if="!budgetsStore.budgets.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.limit') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.spent') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.remaining') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('reports.progress') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="b in budgetsStore.budgets" :key="b.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: b.category_color || '#94a3b8' }"></div>
                  {{ b.category_name || $t('categories.uncategorized') }}
                </div>
              </td>
              <td class="px-5 py-3 text-right font-medium">{{ formatCurrency(b.amount) }}</td>
              <td class="px-5 py-3 text-right">{{ formatCurrency(b.spent || 0) }}</td>
              <td class="px-5 py-3 text-right" :class="(b.amount - (b.spent || 0)) < 0 ? 'text-danger-500' : ''">{{ formatCurrency(b.amount - (b.spent || 0)) }}</td>
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-20 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div class="h-full rounded-full" :style="{ width: Math.min(b.progress || 0, 100) + '%', backgroundColor: (b.progress || 0) >= 100 ? '#f43f5e' : (b.progress || 0) >= 80 ? '#f59e0b' : '#10b981' }"></div>
                  </div>
                  <span class="text-xs">{{ b.progress || 0 }}%</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Debts -->
      <div class="mt-6">
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
            <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_owed') }}</p>
            <p class="text-xl font-bold text-danger-500">{{ formatCurrency(totalOwed) }}</p>
          </div>
          <div class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
            <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_lent') }}</p>
            <p class="text-xl font-bold text-primary-600">{{ formatCurrency(totalLent) }}</p>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h3 class="font-semibold">{{ $t('reports.unpaid') }}</h3>
          </div>
          <div v-if="!unpaidDebts.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
          <table v-else class="w-full text-sm">
            <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
              <tr>
                <th class="text-left px-5 py-3 font-medium">{{ $t('debts.counterparty') }}</th>
                <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
                <th class="text-right px-5 py-3 font-medium">{{ $t('reports.remaining') }}</th>
                <th class="text-right px-5 py-3 font-medium">{{ $t('debts.due_date') }}</th>
                <th class="text-right px-5 py-3 font-medium">{{ $t('reports.status') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr v-for="d in unpaidDebts" :key="d.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                <td class="px-5 py-3">{{ d.counterparty || d.name }}</td>
                <td class="px-5 py-3 text-right font-medium">{{ formatCurrency(d.amount) }}</td>
                <td class="px-5 py-3 text-right text-danger-500 font-medium">{{ formatCurrency(d.remaining) }}</td>
                <td class="px-5 py-3 text-right">{{ d.due_date ? new Date(d.due_date).toLocaleDateString('ru-RU') : '-' }}</td>
                <td class="px-5 py-3 text-right">
                  <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{{ d.status }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recurring -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="font-semibold">{{ $t('reports.upcoming_recurring_payments') }}</h3>
        </div>
        <div v-if="!upcomingRecurring.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('common.name') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.frequency') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.next_date') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="r in upcomingRecurring" :key="r.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td class="px-5 py-3">
                <div>
                  <p class="font-medium">{{ r.note || r.account_name || '-' }}</p>
                  <p class="text-xs text-slate-400">{{ r.account_name }}</p>
                </div>
              </td>
              <td class="px-5 py-3 text-right font-medium" :class="r.type === 'income' ? 'text-primary-600' : 'text-danger-500'">
                {{ r.type === 'income' ? '+' : '−' }}{{ formatCurrency(r.amount) }}
              </td>
              <td class="px-5 py-3 text-right">{{ $t('recurring.frequencies.' + r.frequency) || r.frequency }}</td>
              <td class="px-5 py-3 text-right">{{ new Date(r.next_date).toLocaleDateString('ru-RU') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>

  <script setup>
  import { ref, computed, onMounted, reactive } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useReportsStore } from '../stores/reports'
  import { useAccountsStore } from '../stores/accounts'
  import { useBudgetsStore } from '../stores/budgets'
  import { useDebtsStore } from '../stores/debts'
  import { useRecurringStore } from '../stores/recurring'
  import { useRatesStore } from '../stores/rates'
  import { formatFull } from '@/utils/currency'
  import BaseChart from '@/components/BaseChart.vue'

  const { t } = useI18n()

  const reportsStore = useReportsStore()
  const accountsStore = useAccountsStore()
  const budgetsStore = useBudgetsStore()
  const debtsStore = useDebtsStore()
  const recurringStore = useRecurringStore()
  const ratesStore = useRatesStore()
  const filters = reactive({ from: '', to: '' })
  const categoryType = ref('expense')
  const baseCurrency = computed(() => ratesStore.baseCurrency)

  const isDark = ref(document.documentElement.classList.contains('dark'))

  onMounted(() => {
    const observer = new MutationObserver(() => {
      isDark.value = document.documentElement.classList.contains('dark')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })
  })

  const periodOptions = computed(() => [
    { value: 'today', label: t('reports.today') },
    { value: 'week', label: t('reports.this_week') },
    { value: 'month', label: t('reports.this_month') },
    { value: 'custom', label: t('reports.custom') }
  ])
  const selectedPeriod = ref('month')

  function setPeriod(period) {
    selectedPeriod.value = period
    const now = new Date()
    let from, to

    if (period === 'today') {
      from = to = now.toLocaleDateString('sv-SE')
    } else if (period === 'week') {
      const first = now.getDate() - now.getDay()
      from = new Date(now.setDate(first)).toLocaleDateString('sv-SE')
      to = new Date().toLocaleDateString('sv-SE')
    } else if (period === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('sv-SE')
      to = now.toLocaleDateString('sv-SE')
    } else {
      return
    }

    filters.from = from
    filters.to = to
    applyFilters()
  }

  onMounted(() => {
    setPeriod('month')
    accountsStore.fetchAccounts()
    budgetsStore.fetchBudgets()
    debtsStore.fetchDebts()
    recurringStore.fetchRules()
    ratesStore.fetchRates()
  })

  const net = computed(() => {
    if (!reportsStore.summary) return 0
    return parseFloat(reportsStore.summary.total_income) - parseFloat(reportsStore.summary.total_expense)
  })

  const cryptoAccounts = computed(() => accountsStore.accounts.filter(a => a.type === 'crypto'))

  const cryptoTotalValue = computed(() => {
    return cryptoAccounts.value.reduce((sum, a) => {
      const converted = ratesStore.convert(parseFloat(a.balance), a.currency, baseCurrency.value)
      return sum + (converted !== null ? converted : parseFloat(a.balance))
    }, 0)
  })

  const totalOwed = computed(() => {
    return debtsStore.debts
      .filter(d => d.type === 'borrow' && d.status !== 'paid')
      .reduce((sum, d) => {
        const remaining = parseFloat(d.remaining) || 0
        const converted = ratesStore.convert(remaining, d.currency || baseCurrency.value, baseCurrency.value)
        return sum + (converted !== null ? converted : remaining)
      }, 0)
  })

  const totalLent = computed(() => {
    return debtsStore.debts
      .filter(d => d.type === 'lend' && d.status !== 'paid')
      .reduce((sum, d) => {
        const remaining = parseFloat(d.remaining) || 0
        const converted = ratesStore.convert(remaining, d.currency || baseCurrency.value, baseCurrency.value)
        return sum + (converted !== null ? converted : remaining)
      }, 0)
  })

  const unpaidDebts = computed(() => debtsStore.debts.filter(d => d.status !== 'paid'))

  const upcomingRecurring = computed(() => {
    const now = new Date()
    const thirtyDaysLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)
    return recurringStore.rules.filter(r => {
      if (!r.is_active) return false
      const nextDate = new Date(r.next_date)
      return nextDate >= now && nextDate <= thirtyDaysLater
    })
  })

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
          name: c.name || t('categories.uncategorized'),
          itemStyle: { color: c.color || '#94a3b8' }
        }))
      }
    ]
  }
})

const sankeyData = computed(() => {
  const nodes = []
  const links = []
  const nodeNames = new Set()
  const nodeValues = {}

  // Загружаем данные по доходам
  const incomeCategories = reportsStore.byCategoryAll.filter(c => c.type === 'income' && parseFloat(c.total) > 0)
  incomeCategories.forEach(cat => {
    if (!nodeNames.has(cat.name)) {
      const value = parseFloat(cat.total)
      nodes.push({ 
        name: cat.name, 
        value,
        itemStyle: { color: cat.color || '#94a3b8' } 
      })
      nodeNames.add(cat.name)
      nodeValues[cat.name] = value
    }
    // Связываем доходы с Cash Flow
    links.push({
      source: cat.name,
      target: 'Cash Flow',
      value: parseFloat(cat.total),
      lineStyle: {
        color: cat.color || '#94a3b8',
        curveness: 0.3
      }
    })
  })

  // Добавляем центральный узел Cash Flow
  if (!nodeNames.has('Cash Flow')) {
    const totalIncome = incomeCategories.reduce((sum, c) => sum + parseFloat(c.total), 0)
    nodes.push({ 
      name: 'Cash Flow', 
      value: totalIncome,
      itemStyle: { color: '#059669' } 
    })
    nodeNames.add('Cash Flow')
    nodeValues['Cash Flow'] = totalIncome
  }

  // Загружаем данные по расходам
  const expenseCategories = reportsStore.byCategoryAll.filter(c => c.type === 'expense' && parseFloat(c.total) > 0)
  expenseCategories.forEach(cat => {
    if (!nodeNames.has(cat.name)) {
      const value = parseFloat(cat.total)
      nodes.push({ 
        name: cat.name, 
        value,
        itemStyle: { color: cat.color || '#94a3b8' } 
      })
      nodeNames.add(cat.name)
      nodeValues[cat.name] = value
    }
    // Связываем Cash Flow с расходами
    links.push({
      source: 'Cash Flow',
      target: cat.name,
      value: parseFloat(cat.total),
      lineStyle: {
        color: cat.color || '#94a3b8',
        curveness: 0.3
      }
    })
  })

  return { nodes, links, nodeValues }
})

const sankeyChartOption = computed(() => {
  const { nodes, links } = sankeyData.value
  // Separate nodes by side
  const incomeNodes = nodes.filter(n => {
    return links.some(l => l.source === n.name && l.target === 'Cash Flow')
  })
  const expenseNodes = nodes.filter(n => {
    return links.some(l => l.target === n.name && l.source === 'Cash Flow')
  })

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        if (params.dataType === 'edge') {
          return `${params.data.source} → ${params.data.target}: ${formatFull(params.data.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
        }
        return `${params.name}: ${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
      }
    },
    series: [
      {
        type: 'sankey',
        layout: 'none',
        emphasis: {
          focus: 'adjacency'
        },
        nodeAlign: 'justify',
        nodeWidth: 20,
        nodeGap: 15,
        left: 0,
        right: 0,
        top: 20,
        bottom: 20,
        data: nodes.map(node => ({
          ...node,
          label: {
            show: true,
            position: (incomeNodes.find(n => n.name === node.name) || node.name === 'Cash Flow') ? 'right' : 'left',
            formatter: (params) => {
              return `${params.name}\n${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
            },
            color: isDark.value ? '#f1f5f9' : '#1e293b',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 18,
            distance: 10
          }
        })),
        links: links,
        lineStyle: {
          color: 'source',
          curveness: 0.3,
          opacity: 0.5
        },
        itemStyle: {
          borderWidth: 0,
          borderColor: 'transparent',
          borderRadius: 4
        }
      }
    ]
  }
})

  const loading = ref(false)

  async function applyFilters() {
    loading.value = true
    try {
      await Promise.all([
        reportsStore.fetchSummary({ from: filters.from, to: filters.to }),
        reportsStore.fetchByCategory({ from: filters.from, to: filters.to, type: categoryType.value }),
        reportsStore.fetchByCategoryAll({ from: filters.from, to: filters.to }), // Загружаем все категории для Sankey
        reportsStore.fetchTrend({ from: filters.from, to: filters.to })
      ])
    } catch (e) {
      console.error(e)
      window.$toast?.showToast(e.message || 'Request failed', 'error')
    } finally {
      loading.value = false
    }
  }

  function categoryPercent(total) {
    const sum = reportsStore.byCategory.reduce((s, c) => s + parseFloat(c.total), 0)
    if (sum === 0) return 0
    return Math.round((parseFloat(total) / sum) * 100)
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: baseCurrency.value }).format(value || 0)
  }

  function exportData() {
    reportsStore.exportCsv({ from: filters.from, to: filters.to })
  }
  </script>