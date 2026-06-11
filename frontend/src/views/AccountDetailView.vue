<template>
  <div>
    <div class="flex items-center gap-3 mb-6">
      <button @click="$router.back()" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
        <Icon name="arrowLeft" class="w-5 h-5" />
      </button>
      <h1 class="text-2xl font-bold">{{ account?.name }}</h1>
    </div>

    <div v-if="account" class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm mb-6">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-lg flex items-center justify-center text-white shrink-0" :style="{ backgroundColor: account.color || '#64748b' }">
          <svg v-if="account.type" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-html="typeIcon(account.type)"></svg>
        </div>
        <div class="flex-1">
          <p class="text-sm text-slate-500">{{ $t('accounts.types.' + account.type) }} • {{ account.currency }}</p>
          <p v-if="account.type === 'crypto'" class="text-2xl font-bold font-mono">{{ formatCryptoBalance(account.balance) }} {{ account.currency }}</p>
          <p v-else class="text-2xl font-bold">{{ ratesStore.formatConverted(account.balance, account.currency, false) }}</p>
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

    <div v-if="transactionsStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="transactionsStore.transactions.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('transactions.empty') }}</p>
    </div>

    <div v-else class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
          <tr>
            <th class="text-left px-5 py-3 font-medium">{{ $t('transactions.date') }}</th>
            <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
            <th class="text-left px-5 py-3 font-medium">{{ $t('common.name') }}</th>
            <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr v-for="t in transactionsStore.transactions" :key="t.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
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
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAccountsStore } from '../stores/accounts'
import { useTransactionsStore } from '../stores/transactions'
import { useRatesStore } from '../stores/rates'
import { formatFull } from '@/utils/currency'

const { t } = useI18n()

const route = useRoute()
const accountsStore = useAccountsStore()
const transactionsStore = useTransactionsStore()
const ratesStore = useRatesStore()
const accountId = parseInt(route.params.id)

const account = computed(() => accountsStore.accounts.find(a => a.id === accountId))
const baseCurrency = computed(() => ratesStore.baseCurrency)

const typeIcons = {
  card: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>',
  cash: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  crypto: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
  goal: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  other: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"/>'
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

onMounted(async () => {
  accountsStore.fetchAccounts()
  transactionsStore.fetchTransactions({ account_id: accountId })
  ratesStore.fetchRates()
})

function typeIcon(type) {
  return typeIcons[type] || typeIcons.other
}

function formatCryptoBalance(value) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(value)
}

function formatNote(tx) {
  if (!tx) return ''
  // Outgoing transfer (expense side)
  if (tx.type === 'transfer' && tx.transfer_to_account_id) {
    const target = accountsStore.accounts.find(a => a.id === tx.transfer_to_account_id)
    return target ? `${t('transactions.types.transfer')} → ${target.name}` : (tx.note || '')
  }
  // Incoming paired transfer (income side) — transfer_to_account_id holds source account
  if (tx.type === 'income' && tx.transfer_to_account_id) {
    const source = accountsStore.accounts.find(a => a.id === tx.transfer_to_account_id)
    return source ? `${t('transactions.types.transfer')} ← ${source.name}` : (tx.note || '')
  }
  if (!tx.note) return ''
  return tx.note
    .replace(/^Debt created:\s*/, t('debts.tx_created') + ': ')
    .replace(/^debt_created:\s*/, t('debts.tx_created') + ': ')
    .replace(/^Debt payment:\s*/, t('debts.tx_payment') + ': ')
    .replace(/^debt_payment:\s*/, t('debts.tx_payment') + ': ')
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('ru-RU')
}

function formatAmount(tx) {
  const sign = tx.type === 'income' ? '+' : (tx.type === 'expense' ? '−' : '')
  const isCrypto = account.value?.type === 'crypto'
  const currency = tx.account_currency || account.value?.currency || 'USD'
  const full = formatFull(tx.amount, currency, baseCurrency.value, ratesStore.rates)
  return `${sign}${full}`
}

function amountClass(type) {
  if (type === 'income') return 'text-primary-600'
  if (type === 'expense') return 'text-danger-500'
  return 'text-slate-700 dark:text-slate-300'
}

function categoryClass(type) {
  if (type === 'income') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (type === 'expense') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
}
</script>
