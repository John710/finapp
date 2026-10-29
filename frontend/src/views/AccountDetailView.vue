<template>
  <div>
    <div class="flex items-center gap-3 mb-6">
      <button type="button" class="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" :aria-label="$t('common.back')" @click="$router.back()">
        <Icon name="arrowLeft" class="w-5 h-5" />
      </button>
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ account?.name }}</h1>
    </div>

    <div v-if="account" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark mb-6">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-lg flex items-center justify-center text-white shrink-0" :style="{ backgroundColor: account.color || '#64748b' }">
          <Icon v-if="account.type" :name="typeIconName(account.type)" class="w-6 h-6" />
        </div>
        <div class="flex-1">
          <p class="text-sm text-slate-500">{{ $t('accounts.types.' + account.type) }} • {{ account.currency }}</p>
          <p v-if="account.type === 'crypto'" class="font-display text-2xl lg:text-3xl font-semibold tracking-tight font-mono">{{ formatCryptoBalance(account.balance) }} {{ account.currency }}</p>
          <p v-else class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ ratesStore.formatConverted(account.balance, account.currency, false) }}</p>
          <p v-if="account.type === 'crypto' && cryptoValue" class="text-sm text-slate-500">≈ {{ ratesStore.format(cryptoValue, baseCurrency) }}</p>
          <p v-else-if="account.currency !== baseCurrency" class="text-sm text-slate-500">{{ ratesStore.formatConverted(account.balance, account.currency) }}</p>
        </div>
      </div>
      <!-- Goal progress -->
      <div v-if="account.type === 'goal'" class="mt-4">
        <div class="flex justify-between text-sm mb-1">
          <span class="font-medium">{{ ratesStore.formatConverted(account.balance, account.currency, false) }} {{ $t('accounts.of') }} {{ ratesStore.formatConverted(account.target_amount, account.currency, false) }}</span>
          <span class="font-medium" :class="goalColor">{{ goalProgress }}%</span>
        </div>
        <div class="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all" :class="goalBarColor" :style="{ width: Math.min(goalProgress, 100) + '%' }"></div>
        </div>
        <p class="text-xs mt-1 text-slate-500">{{ goalProgress }}% {{ $t('accounts.completed') }}</p>
      </div>
    </div>

    <h2 class="text-lg font-semibold mb-4">{{ $t('transactions.title') }}</h2>

    <div v-if="listLoading" class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-5 space-y-4">
      <div v-for="i in 5" :key="i" class="flex items-center gap-4">
        <BaseSkeleton height="2.5rem" width="2.5rem" />
        <div class="flex-1 space-y-2">
          <BaseSkeleton height="0.8rem" width="55%" />
          <BaseSkeleton height="0.6rem" width="35%" />
        </div>
        <BaseSkeleton height="1rem" width="5rem" />
      </div>
    </div>

    <div v-else-if="rows.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('transactions.empty') }}</p>
    </div>

    <div v-else class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
          <tr>
            <th class="text-left px-5 py-3 font-medium">{{ $t('transactions.date') }}</th>
            <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
            <th class="text-left px-5 py-3 font-medium">{{ $t('common.name') }}</th>
            <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr v-for="t in rows" :key="t.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
            <td class="px-5 py-3 text-slate-500">{{ formatDate(t.date) }}</td>
            <td class="px-5 py-3">
              <span v-if="t.type === 'transfer' || (t.type === 'income' && t.transfer_to_account_id)" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{{ $t('transactions.types.transfer') }}</span>
              <span v-else-if="t.category_name || t.category_id" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="categoryClass(t.type)">{{ t.category_name || '-' }}</span>
            </td>
            <td class="px-5 py-3">{{ formatNote(t) || '-' }}</td>
            <td class="px-5 py-3 text-right font-medium" :class="amountClass(t.type)">{{ formatAmount(t) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="rows.length < total" class="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-sm text-slate-500">
        <span>{{ rows.length }} / {{ total }}</span>
        <button :disabled="loadingMore" class="px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium disabled:opacity-50" @click="loadMore">
          {{ loadingMore ? $t('common.loading') : $t('common.load_more') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAccountsStore } from '../stores/accounts'
import { useRatesStore } from '../stores/rates'
import { formatFull } from '@/utils/currency'
import { getUserLocale } from '@/utils/locale'
import { formatDate as formatDateValue } from '@/utils/format'
import { api } from '@/utils/api'
import { logger } from '@/utils/logger.js'
import { useTransactionDisplay } from '@/composables/useTransactionDisplay'
import BaseSkeleton from '@/components/BaseSkeleton.vue'

const { t } = useI18n()

const route = useRoute()
const accountsStore = useAccountsStore()
const ratesStore = useRatesStore()
const { formatNote, amountClass, categoryClass } = useTransactionDisplay(accountsStore)
const accountId = computed(() => parseInt(route.params.id, 10))

const account = computed(() => accountsStore.accounts.find(a => a.id === accountId.value))
const baseCurrency = computed(() => ratesStore.baseCurrency)

const typeIconMap = {
  card: 'creditCard',
  cash: 'money',
  crypto: 'wallet',
  goal: 'check',
  other: 'more'
}

const goalProgress = computed(() => {
  if (!account.value?.target_amount || parseFloat(account.value.target_amount) === 0) return 0
  return Math.round((parseFloat(account.value.balance) / parseFloat(account.value.target_amount)) * 100)
})

const goalBarColor = computed(() => {
  const p = goalProgress.value
  if (p >= 100) return 'bg-emerald-500'
  if (p >= 75) return 'bg-primary-500'
  if (p >= 50) return 'bg-warning-400'
  return 'bg-slate-400'
})

const goalColor = computed(() => {
  const p = goalProgress.value
  if (p >= 100) return 'text-emerald-500'
  if (p >= 75) return 'text-primary-500'
  if (p >= 50) return 'text-warning-400'
  return 'text-slate-400'
})

const cryptoValue = computed(() => {
  if (!account.value || account.value.type !== 'crypto') return null
  const converted = ratesStore.convert(parseFloat(account.value.balance), account.value.currency, baseCurrency.value)
  return converted !== null ? converted : null
})

// The list is local to this view: the shared transactions store still holds the
// previous view's rows, which would flash here (and be overwritten by it).
const PAGE_SIZE = 50
const rows = ref([])
const total = ref(0)
const listLoading = ref(true)
const loadingMore = ref(false)
let listController = null

async function loadRows({ append = false } = {}) {
  listController?.abort()
  const controller = new AbortController()
  listController = controller
  const id = accountId.value
  if (append) {
    loadingMore.value = true
  } else {
    rows.value = []
    total.value = 0
    listLoading.value = true
  }
  try {
    const query = new URLSearchParams({
      account_id: String(id),
      limit: String(PAGE_SIZE),
      offset: String(append ? rows.value.length : 0)
    })
    const data = await api(`/transactions?${query}`, { signal: controller.signal })
    // Ignore a response that lost the race against a newer request
    if (controller !== listController) return
    rows.value = append ? [...rows.value, ...data.items] : data.items
    total.value = data.total
  } catch (e) {
    if (e?.name === 'AbortError' || controller !== listController) return
    logger.error('Failed to load account transactions', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    if (controller === listController) {
      listLoading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  if (loadingMore.value || rows.value.length >= total.value) return
  loadRows({ append: true })
}

onMounted(() => {
  accountsStore.fetchAccounts()
  ratesStore.fetchRates()
})

// The router reuses this component when only :id changes: refetch for the new account
watch(accountId, () => {
  if (Number.isFinite(accountId.value)) loadRows()
}, { immediate: true })

onUnmounted(() => {
  listController?.abort()
})

function typeIconName(type) {
  return typeIconMap[type] || typeIconMap.other
}

function formatCryptoBalance(value) {
  return new Intl.NumberFormat(getUserLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(value)
}

function formatDate(date) {
  return formatDateValue(date)
}

function formatAmount(tx) {
  const sign = tx.type === 'income' ? '+' : (tx.type === 'expense' ? '−' : '')
  const isCrypto = account.value?.type === 'crypto'
  const currency = tx.account_currency || account.value?.currency || 'USD'
  const full = formatFull(tx.amount, currency, baseCurrency.value, ratesStore.rates)
  return `${sign}${full}`
}
</script>
