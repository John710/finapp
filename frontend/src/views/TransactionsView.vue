<template>
  <div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <h1 class="text-2xl font-bold">{{ $t('transactions.title') }}</h1>
      <div class="flex gap-2 self-start">
        <button @click="openModal()" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <Icon name="plus" class="w-4 h-4" />
          {{ $t('common.add') }}
        </button>
        <button @click="showImportModal = true" class="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2">
          <Icon name="upload" class="w-4 h-4" />
          {{ $t('import.title') }}
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm mb-4 flex flex-wrap gap-3">
      <input v-model="filters.search" @input="applyFilters" type="text" :placeholder="$t('common.search') + '...'" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm w-full lg:w-64 focus:outline-none focus:ring-2 focus:ring-primary-500" />
      <select v-model="filters.account_id" @change="applyFilters" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('accounts.title') }}</option>
        <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
      </select>
      <select v-model="filters.category_id" @change="applyFilters" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('categories.title') }}</option>
        <option v-for="cat in categoriesStore.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
      </select>
      <select v-model="filters.type" @change="applyFilters" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('common.type') }}</option>
        <option value="income">{{ $t('categories.types.income') }}</option>
        <option value="expense">{{ $t('categories.types.expense') }}</option>
        <option value="transfer">{{ $t('transactions.types.transfer') }}</option>
      </select>
      <select v-model="filters.tag_id" @change="applyFilters" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('tags.title') }}</option>
        <option v-for="tag in tagsStore.tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
      </select>
      <button @click="resetFilters" class="ml-auto px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300">
        {{ $t('common.reset_filters') }}
      </button>
    </div>

    <div v-if="transactionsStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="transactionsStore.transactions.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('transactions.empty') }}</p>
    </div>

    <div v-else>
      <!-- Desktop table -->
      <div class="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('transactions.date') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('common.name') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('accounts.title') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('tags.title') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
              <th class="px-5 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="t in transactionsStore.transactions" :key="t.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td class="px-5 py-3 text-slate-500">{{ formatDate(t.date) }}</td>
              <td class="px-5 py-3">
                <span v-if="t.type === 'transfer' || (t.type === 'income' && t.transfer_to_account_id)" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {{ $t('transactions.types.transfer') }}
                </span>
                <span v-else-if="t.category_name || t.category_id" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium" :class="categoryClass(t.type)">
                  <Icon v-if="t.category_icon" :name="t.category_icon" set="category" class="w-3.5 h-3.5" />
                  {{ t.category_name || '-' }}
                </span>
              </td>
              <td class="px-5 py-3">{{ formatNote(t) || '-' }}</td>
              <td class="px-5 py-3 text-slate-500">{{ t.account_name }}</td>
              <td class="px-5 py-3">
                <div class="flex flex-wrap gap-1">
                  <span v-for="tag in t.tags" :key="tag.id" class="px-1.5 py-0.5 rounded text-[10px] font-medium" :style="{ backgroundColor: tag.color || '#94a3b8', color: '#fff' }">{{ tag.name }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-right font-medium" :class="amountClass(t.type)">{{ formatAmount(t) }}</td>
              <td class="px-5 py-3">
                <button @click="deleteTransaction(t.id)" class="text-slate-400 hover:text-danger-500 transition-colors">
                  <Icon name="delete" class="w-4 h-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-sm text-slate-500">
          <span>{{ transactionsStore.total }} {{ $t('transactions.total') }}</span>
        </div>
      </div>

      <!-- Mobile cards -->
      <div class="lg:hidden space-y-3">
        <div v-for="t in transactionsStore.transactions" :key="t.id" class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div class="flex justify-between items-start mb-2">
            <span v-if="t.type === 'transfer' || (t.type === 'income' && t.transfer_to_account_id)" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {{ $t('transactions.types.transfer') }}
            </span>
            <span v-else-if="t.category_name || t.category_id" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium" :class="categoryClass(t.type)">
              <Icon v-if="t.category_icon" :name="t.category_icon" set="category" class="w-3.5 h-3.5" />
              {{ t.category_name || '-' }}
            </span>
            <span class="font-medium" :class="amountClass(t.type)">{{ formatAmount(t) }}</span>
          </div>
          <p class="font-medium">{{ formatNote(t) || '-' }}</p>
          <p class="text-xs text-slate-500 mt-1">{{ formatDate(t.date) }} • {{ t.account_name }}</p>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 relative z-10">
        <h2 class="text-xl font-bold mb-4">{{ $t('common.add') }}</h2>
        <form @submit.prevent="saveTransaction" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" @click="form.type = 'expense'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-danger-500' : 'text-slate-500'">{{ $t('categories.types.expense') }}</button>
              <button type="button" @click="form.type = 'income'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500' : 'text-slate-500'">{{ $t('categories.types.income') }}</button>
              <button type="button" @click="form.type = 'transfer'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'transfer' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-500' : 'text-slate-500'">{{ $t('transactions.types.transfer') }}</button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ selectedAccount?.type === 'crypto' ? $t('transactions.quantity') : $t('transactions.amount') }}</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{{ selectedAccount?.currency || baseCurrency }}</span>
              <input v-model.number="form.amount" type="number" :step="selectedAccount?.type === 'crypto' ? '0.00000001' : '0.01'" required class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('accounts.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.account_id" required class="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" @click="openQuickAccount('account_id')" class="shrink-0 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div v-if="form.type !== 'transfer'">
            <label class="block text-sm font-medium mb-1">{{ $t('categories.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.category_id" class="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option :value="null">-</option>
                <option v-for="cat in filteredCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
              <button type="button" @click="showQuickCategory = true" class="shrink-0 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div v-if="form.type === 'transfer'">
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.to_account') }}</label>
            <div class="flex gap-2">
              <select v-model="form.transfer_to_account_id" class="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option v-for="acc in accountsStore.accounts.filter(a => a.id !== form.account_id)" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" @click="openQuickAccount('transfer_to_account_id')" class="shrink-0 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('transactions.date') }}</label>
              <input v-model="form.date" type="date" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.note') }}</label>
            <textarea v-model="form.note" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent resize-none h-20" :placeholder="$t('transactions.note_placeholder')"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('tags.title') }}</label>
            <div class="flex flex-wrap gap-2 mb-2">
              <button type="button" v-for="tag in tagsStore.tags" :key="tag.id" @click="toggleTag(tag.id)"
                class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                :class="form.tags.includes(tag.id) ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'">
                {{ tag.name }}
              </button>
            </div>
            <div class="flex gap-2 items-center">
              <input v-model="newTagName" :placeholder="$t('tags.add')" class="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" @keyup.enter="addTag" />
              <div class="flex flex-wrap gap-1">
                <button v-for="color in presetColors" :key="color" type="button" @click="newTagColor = color"
                  class="w-6 h-6 rounded-full transition-all"
                  :class="newTagColor === color ? 'ring-2 ring-offset-1 dark:ring-offset-slate-900' : ''"
                  :style="{ backgroundColor: color, ringColor: color }"></button>
              </div>
              <button type="button" @click="addTag" class="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700">{{ $t('common.add') }}</button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closeModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <ImportCsvModal v-model="showImportModal" @imported="transactionsStore.fetchTransactions()" />
    <QuickAccountModal v-model="showQuickAccount" @created="onQuickAccountCreated" />
    <QuickCategoryModal v-model="showQuickCategory" :default-type="form.type" @created="onQuickCategoryCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTransactionsStore } from '../stores/transactions'
import { useAccountsStore } from '../stores/accounts'
import { useCategoriesStore } from '../stores/categories'
import { useTagsStore } from '../stores/tags'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import { formatFull } from '@/utils/currency'
import ImportCsvModal from '../components/ImportCsvModal.vue'
import QuickAccountModal from '../components/QuickAccountModal.vue'
import QuickCategoryModal from '../components/QuickCategoryModal.vue'
import Icon from '../components/Icon.vue'

const { t } = useI18n()
const route = useRoute()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => localStorage.getItem('base_currency') || 'USD')
const undo = useUndo()

useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveTransaction() },
  'esc': () => { if (showModal.value) closeModal() }
})

const presetColors = ['#f43f5e', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#f472b6', '#94a3b8']

const transactionsStore = useTransactionsStore()
const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const tagsStore = useTagsStore()
const showModal = ref(false)
const showImportModal = ref(false)
const showQuickAccount = ref(false)
const showQuickCategory = ref(false)
const quickAccountTarget = ref('account_id')
const filters = reactive({ search: '', account_id: '', category_id: '', type: '', tag_id: '' })
const form = reactive({ type: 'expense', amount: 0, account_id: null, category_id: null, date: new Date().toLocaleDateString('sv-SE'), note: '', transfer_to_account_id: null, tags: [] })
const newTagName = ref('')
const newTagColor = ref('#94a3b8')


onMounted(() => {
  accountsStore.fetchAccounts()
  categoriesStore.fetchCategories()
  tagsStore.fetchTags()
  ratesStore.fetchRates()
  if (route.query.tag_id) {
    filters.tag_id = String(route.query.tag_id)
  }
  applyFilters()
  window.addEventListener('open-transaction-modal', openModal)
})

onUnmounted(() => {
  window.removeEventListener('open-transaction-modal', openModal)
})

const filteredCategories = computed(() => {
  return categoriesStore.categories.filter(c => c.type === form.type)
})

const selectedAccount = computed(() => {
  return accountsStore.accounts.find(a => a.id === form.account_id)
})

function applyFilters() {
  const params = {}
  if (filters.search) params.search = filters.search
  if (filters.account_id) params.account_id = filters.account_id
  if (filters.category_id) params.category_id = filters.category_id
  if (filters.type) params.type = filters.type
  if (filters.tag_id) params.tag_id = filters.tag_id
  transactionsStore.fetchTransactions(params)
}

function resetFilters() {
  filters.search = ''
  filters.account_id = ''
  filters.category_id = ''
  filters.type = ''
  filters.tag_id = ''
  applyFilters()
}

function formatNote(tx) {
  if (!tx) return ''
  // Outgoing transfer
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
  const full = formatFull(tx.amount, tx.account_currency, baseCurrency.value, ratesStore.rates)
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

function openModal() {
  Object.assign(form, { type: 'expense', amount: 0, account_id: accountsStore.accounts[0]?.id || null, category_id: null, date: new Date().toLocaleDateString('sv-SE'), note: '', transfer_to_account_id: null, tags: [] })
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function openQuickAccount(field) {
  quickAccountTarget.value = field
  showQuickAccount.value = true
}

function onQuickAccountCreated(account) {
  form[quickAccountTarget.value] = account.id
}

function onQuickCategoryCreated(category) {
  form.category_id = category.id
}

function toggleTag(tagId) {
  const idx = form.tags.indexOf(tagId)
  if (idx === -1) {
    form.tags.push(tagId)
  } else {
    form.tags.splice(idx, 1)
  }
}

async function addTag() {
  if (!newTagName.value.trim()) return
  const tag = await tagsStore.createTag({ name: newTagName.value.trim(), color: newTagColor.value })
  form.tags.push(tag.id)
  newTagName.value = ''
  newTagColor.value = '#94a3b8'
}

async function saveTransaction() {
  await transactionsStore.createTransaction({ ...form })
  window.$toast?.success(t('common.created'))
  closeModal()
  applyFilters()
}

async function deleteTransaction(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const tx = transactionsStore.transactions.find(x => x.id === id)
  await transactionsStore.deleteTransaction(id)
  applyFilters()
  if (tx) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await transactionsStore.createTransaction({
          account_id: tx.account_id,
          category_id: tx.category_id,
          amount: tx.amount,
          type: tx.type,
          date: tx.date,
          note: tx.note,
          transfer_to_account_id: tx.transfer_to_account_id
        })
        applyFilters()
      }
    })
  }
}
</script>
