  <template>
    <div>
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('reports.title') }}</h1>
        <button class="bg-primary-500 hover:bg-primary-600 shadow-card text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors self-start disabled:opacity-50" :disabled="exporting" @click="exportData">
          <Icon name="upload" class="w-4 h-4" />
          {{ $t('reports.export_csv') }}
        </button>
      </div>

      <!-- Filters -->
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-card dark:shadow-card-dark mb-6 flex flex-wrap gap-3 items-center">
        <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
v-for="p in periodOptions" :key="p.value" class="px-3 py-2 rounded-md text-sm font-medium transition-colors"
            :class="selectedPeriod === p.value ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'"
            @click="setPeriod(p.value)">
            {{ p.label }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-slate-500">{{ $t('reports.from') }}</label>
          <input v-model="filters.from" type="date" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm" />
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-slate-500">{{ $t('reports.to') }}</label>
          <input v-model="filters.to" type="date" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm" />
        </div>
        <button :disabled="loading" class="px-4 py-2 bg-primary-500 hover:bg-primary-600 shadow-card disabled:opacity-50 text-white rounded-full text-sm font-medium transition-colors" @click="applyFilters">
          {{ loading ? $t('common.loading') + '...' : $t('reports.apply') }}
        </button>
      </div>

      <!-- Summary cards -->
      <div v-if="reportsStore.summary" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_income') }}</p>
          <p class="font-display text-xl font-semibold text-primary-600">+{{ formatCurrency(reportsStore.summary.total_income) }}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_expense') }}</p>
          <p class="font-display text-xl font-semibold text-danger-500">−{{ formatCurrency(reportsStore.summary.total_expense) }}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_transfer') }}</p>
          <p class="font-display text-xl font-semibold text-blue-500">{{ formatCurrency(reportsStore.summary.total_transfer || 0) }}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark text-center">
          <p class="text-xs text-slate-500 mb-1">{{ $t('reports.net') }}</p>
          <p class="font-display text-xl font-semibold" :class="net >= 0 ? 'text-primary-600' : 'text-danger-500'">{{ net >= 0 ? '+' : '' }}{{ formatCurrency(net) }}</p>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-6">
        <!-- Trend chart -->
        <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark">
          <h3 class="font-semibold mb-4">{{ $t('reports.monthly_trend') }}</h3>
          <div v-if="reportsStore.trend.length" class="relative h-64">
            <BaseChart :option="trendChartOption" />
          </div>
          <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
        </div>

        <!-- Category chart -->
        <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">{{ categoryType === 'income' ? $t('reports.income_by_category') : $t('reports.expenses_by_category') }}</h3>
            <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button
v-for="t in ['expense', 'income']" :key="t" class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                :class="categoryType === t ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'"
                @click="categoryType = t">
                {{ $t('categories.types.' + t) }}
              </button>
            </div>
          </div>
          <div v-if="typedCategories.filter(c => parseFloat(c.total) > 0).length" class="relative h-64">
            <BaseChart :option="categoryChartOption" />
          </div>
          <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
        </div>
      </div>

      <!-- Sankey chart -->
      <div v-if="sankeyData.links.length" class="mt-6 bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark">
        <h3 class="font-semibold mb-4">{{ $t('reports.cash_flow') }}</h3>
        <div class="relative h-[400px]">
          <BaseChart :option="sankeyChartOption" :height="'400px'" />
        </div>
      </div>

      <!-- Category table -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="font-semibold">{{ $t('reports.by_category') }}</h3>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('reports.count') }}</th>
              <th class="text-right px-5 py-3 font-medium">%</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="cat in typedCategories" :key="cat.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
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
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 class="font-semibold">{{ $t('reports.crypto_holdings') }}</h3>
          <span v-if="cryptoAccounts.length" class="text-sm font-bold text-slate-900 dark:text-white">{{ formatCurrency(cryptoTotalValue) }}</span>
        </div>
        <div v-if="!cryptoAccounts.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
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
              <td class="px-5 py-3 text-right font-medium">{{ parseFloat(acc.balance).toLocaleString(getUserLocale(), { maximumFractionDigits: 8 }) }}</td>
              <td class="px-5 py-3 text-right font-medium">{{ formatCurrency(ratesStore.convert(parseFloat(acc.balance), acc.currency, baseCurrency.value) ?? parseFloat(acc.balance)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Budgets -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="font-semibold">{{ $t('reports.budgets') }}</h3>
        </div>
        <div v-if="!budgetsStore.budgets.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
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
          <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark text-center">
            <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_owed') }}</p>
            <p class="font-display text-xl font-semibold text-danger-500">{{ formatCurrency(totalOwed) }}</p>
          </div>
          <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark text-center">
            <p class="text-xs text-slate-500 mb-1">{{ $t('reports.total_lent') }}</p>
            <p class="font-display text-xl font-semibold text-primary-600">{{ formatCurrency(totalLent) }}</p>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h3 class="font-semibold">{{ $t('reports.unpaid') }}</h3>
          </div>
          <div v-if="!unpaidDebts.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
          <table v-else class="w-full text-sm">
            <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
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
                <td class="px-5 py-3 text-right">{{ formatDate(d.due_date) }}</td>
                <td class="px-5 py-3 text-right">
                  <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{{ d.status }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recurring plan vs actual -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 class="font-semibold">{{ $t('reports.recurring_plan_vs_actual') }}</h3>
          <div class="flex flex-wrap gap-3">
            <div v-for="item in recurringPlanLegend" :key="item.label" class="flex items-center gap-1.5 text-xs text-slate-500">
              <div class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: item.color }"></div>
              {{ item.label }}
            </div>
          </div>
        </div>
        <div v-if="hasRecurringPlan" class="relative h-64">
          <BaseChart :option="recurringPlanChartOption" />
        </div>
        <p v-else class="text-slate-500 text-center py-12">{{ $t('dashboard.no_chart_data') }}</p>
      </div>

      <!-- Recurring -->
      <div class="mt-6 bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="font-semibold">{{ $t('reports.upcoming_recurring_payments') }}</h3>
        </div>
        <div v-if="!upcomingRecurring.length" class="p-8 text-center text-slate-500">{{ $t('common.empty') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
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
              <td class="px-5 py-3 text-right">{{ formatDate(r.next_date) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>

  <script setup>
import { logger } from '@/utils/logger.js'
  import { ref, computed, defineAsyncComponent, onMounted, reactive } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useDarkMode } from '@/composables/useDarkMode.js'
  import { useChartOptions } from '@/composables/useChartOptions'
  import { useI18n } from 'vue-i18n'
  import { useReportsStore } from '../stores/reports'
  import { useAccountsStore } from '../stores/accounts'
  import { useBudgetsStore } from '../stores/budgets'
  import { useDebtsStore } from '../stores/debts'
  import { useRecurringStore } from '../stores/recurring'
  import { useRatesStore } from '../stores/rates'
  import { format as echartsFormat } from 'echarts/core'
  import { formatFull } from '@/utils/currency'
  import { getUserLocale } from '@/utils/locale'
  import { formatCurrency as formatCurrencyValue, formatDate } from '@/utils/format'
  const BaseChart = defineAsyncComponent(() => import('@/components/BaseChart.vue'))

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()

  const reportsStore = useReportsStore()
  const accountsStore = useAccountsStore()
  const budgetsStore = useBudgetsStore()
  const debtsStore = useDebtsStore()
  const recurringStore = useRecurringStore()
  const ratesStore = useRatesStore()
  const filters = reactive({ from: '', to: '' })
  const categoryType = ref('expense')
  const baseCurrency = computed(() => ratesStore.baseCurrency)

  const { isDark } = useDarkMode()
  const { trendChartOption: buildTrendOption, categoryChartOption: buildCategoryOption, recurringPlanChartOption: buildRecurringPlanOption } = useChartOptions({ isDark, baseCurrency, ratesStore })

  const periodOptions = computed(() => [
    { value: 'today', label: t('reports.today') },
    { value: 'week', label: t('reports.this_week') },
    { value: 'month', label: t('reports.this_month') },
    { value: 'custom', label: t('reports.custom') }
  ])
  const selectedPeriod = ref('month')

  // The pie chart and the table show only the selected type, but both come from
  // a single unfiltered /reports/by-category request (the Sankey needs all
  // types anyway) — the toggle below is a pure client-side filter.
  const typedCategories = computed(() => reportsStore.byCategoryAll.filter(c => c.type === categoryType.value))

  function setPeriod(period) {
    selectedPeriod.value = period
    const now = new Date()
    let from, to

    if (period === 'today') {
      from = to = now.toLocaleDateString('sv-SE')
    } else if (period === 'week') {
      const first = now.getDate() - now.getDay()
      const weekStart = new Date(now)
      weekStart.setDate(first)
      from = weekStart.toLocaleDateString('sv-SE')
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
    // Restore the period from the URL (shareable, survives F5), default to this month
    if (route.query.from || route.query.to) {
      filters.from = route.query.from ? String(route.query.from) : ''
      filters.to = route.query.to ? String(route.query.to) : ''
      selectedPeriod.value = 'custom'
      applyFilters()
    } else {
      setPeriod('month')
    }
    accountsStore.fetchAccounts()
    budgetsStore.fetchBudgets()
    debtsStore.fetchDebts()
    recurringStore.fetchRules()
    ratesStore.fetchRates()
    // The projection window is capped at 400 days server-side, so the plan
    // card always shows the current calendar year rather than the chart filter.
    const year = new Date().getFullYear()
    reportsStore.fetchRecurringPlan({ from: `${year}-01-01`, to: `${year}-12-31` })
      .catch(e => logger.error('Recurring plan failed', e))
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

  // next_date is a 'YYYY-MM-DD' calendar day: compare it as text against the
  // local day instead of parsing it as UTC midnight (which dropped today's
  // payments east of UTC and kept yesterday's west of it).
  const upcomingRecurring = computed(() => {
    const now = new Date()
    const today = now.toLocaleDateString('sv-SE')
    const thirtyDaysLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30).toLocaleDateString('sv-SE')
    return recurringStore.rules.filter(r =>
      r.is_active && typeof r.next_date === 'string' && r.next_date >= today && r.next_date <= thirtyDaysLater
    )
  })

const trendChartOption = computed(() => buildTrendOption(reportsStore.trend))

const categoryChartOption = computed(() => buildCategoryOption(typedCategories.value.filter(c => parseFloat(c.total) > 0)))

const recurringPlanMonths = computed(() => reportsStore.recurringPlan?.months || [])
const hasRecurringPlan = computed(() => recurringPlanMonths.value.some(m =>
  parseFloat(m.plan_income) > 0 || parseFloat(m.plan_expense) > 0 ||
  parseFloat(m.actual_income) > 0 || parseFloat(m.actual_expense) > 0))
const recurringPlanChartOption = computed(() => buildRecurringPlanOption(reportsStore.recurringPlan))

// The chart hides its built-in legend (ECharts legend names would be truncated),
// so the four series are labelled here instead.
const recurringPlanLegend = computed(() => [
  { label: `${t('reports.income')} · ${t('reports.plan')}`, color: 'rgba(124, 111, 222, 0.35)' },
  { label: `${t('reports.income')} · ${t('reports.actual')}`, color: '#7c6fde' },
  { label: `${t('reports.expense')} · ${t('reports.plan')}`, color: 'rgba(184, 193, 234, 0.45)' },
  { label: `${t('reports.expense')} · ${t('reports.actual')}`, color: '#8fa2d8' }
])

// Sankey node names are ECharts' node ids and must be unique: an income and an
// expense category can share a name (that made the graph cyclic: "Sankey is a
// DAG"). Nodes therefore use ids like `income:<categoryId>`, and the readable
// name travels in `title` (shown by the label/tooltip formatters).
const SANKEY_CASH_FLOW_ID = 'cash_flow'
const encodeHTML = (value) => echartsFormat.encodeHTML(String(value ?? ''))

const sankeyData = computed(() => {
  const nodes = []
  const links = []
  const nodeValues = {}
  const titles = { [SANKEY_CASH_FLOW_ID]: t('reports.cash_flow') }
  const categoryTitle = (cat) => cat.name || t('categories.uncategorized')
  const categoryNodeId = (type, cat) => `${type}:${cat.id ?? 'none'}`

  // Build income nodes
  const incomeCategories = reportsStore.byCategoryAll.filter(c => c.type === 'income' && parseFloat(c.total) > 0)
  incomeCategories.forEach(cat => {
    const id = categoryNodeId('income', cat)
    const value = parseFloat(cat.total)
    titles[id] = categoryTitle(cat)
    nodes.push({
      name: id,
      title: titles[id],
      value,
      itemStyle: { color: cat.color || '#94a3b8' }
    })
    nodeValues[id] = value
    // Link income categories to Cash Flow
    links.push({
      source: id,
      target: SANKEY_CASH_FLOW_ID,
      value,
      lineStyle: {
        color: cat.color || '#94a3b8',
        curveness: 0.3
      }
    })
  })

  // Add central Cash Flow node
  const totalIncome = incomeCategories.reduce((sum, c) => sum + parseFloat(c.total), 0)
  nodes.push({
    name: SANKEY_CASH_FLOW_ID,
    title: titles[SANKEY_CASH_FLOW_ID],
    value: totalIncome,
    itemStyle: { color: '#7c6fde' }
  })
  nodeValues[SANKEY_CASH_FLOW_ID] = totalIncome

  // Build expense nodes
  const expenseCategories = reportsStore.byCategoryAll.filter(c => c.type === 'expense' && parseFloat(c.total) > 0)
  expenseCategories.forEach(cat => {
    const id = categoryNodeId('expense', cat)
    const value = parseFloat(cat.total)
    titles[id] = categoryTitle(cat)
    nodes.push({
      name: id,
      title: titles[id],
      value,
      itemStyle: { color: cat.color || '#94a3b8' }
    })
    nodeValues[id] = value
    // Link Cash Flow to expense categories
    links.push({
      source: SANKEY_CASH_FLOW_ID,
      target: id,
      value,
      lineStyle: {
        color: cat.color || '#94a3b8',
        curveness: 0.3
      }
    })
  })

  return { nodes, links, nodeValues, titles }
})

const sankeyChartOption = computed(() => {
  const { nodes, links, titles } = sankeyData.value
  // Separate nodes by side: the label sits to the right of income/cash-flow
  // nodes and to the left of expense nodes
  const incomeNodeIds = new Set(
    links.filter(l => l.target === SANKEY_CASH_FLOW_ID).map(l => l.source)
  )

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        // Names come from user data and ECharts renders this string as HTML
        if (params.dataType === 'edge') {
          return `${encodeHTML(titles[params.data.source])} → ${encodeHTML(titles[params.data.target])}: ${formatFull(params.data.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
        }
        return `${encodeHTML(params.data?.title)}: ${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
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
            position: (incomeNodeIds.has(node.name) || node.name === SANKEY_CASH_FLOW_ID) ? 'right' : 'left',
            formatter: (params) => {
              // Canvas text, not HTML: no escaping needed
              return `${params.data?.title}\n${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}`
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
        reportsStore.fetchByCategoryAll({ from: filters.from, to: filters.to }),
        reportsStore.fetchTrend({ from: filters.from, to: filters.to })
      ])
    } catch (e) {
      logger.error(e)
      window.$toast?.error(e.message || t('common.error'))
    } finally {
      loading.value = false
    }
    // Keep the date range in the URL so the view is shareable and survives F5
    router.replace({ query: { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) } })
  }

  function categoryPercent(total) {
    const sum = typedCategories.value.reduce((s, c) => s + parseFloat(c.total), 0)
    if (sum === 0) return 0
    return Math.round((parseFloat(total) / sum) * 100)
  }

  function formatCurrency(value) {
    return formatCurrencyValue(value || 0, baseCurrency.value)
  }

  const exporting = ref(false)

  async function exportData() {
    if (exporting.value) return
    exporting.value = true
    try {
      await reportsStore.exportCsv({ from: filters.from, to: filters.to })
    } catch (e) {
      logger.error('Export failed', e)
      window.$toast?.error(e.message || t('common.error'))
    } finally {
      exporting.value = false
    }
  }
  </script>