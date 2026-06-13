<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ $t('debts.title') }}</h1>
      <button @click="openModal()" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="debtsStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="debtsStore.debts.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('debts.empty') }}</p>
    </div>

    <div v-else class="space-y-4">
      <div v-for="debt in debtsStore.debts" :key="debt.id" class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm" :class="{ 'opacity-60': debt.status === 'paid' }">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full" :class="debt.type === 'borrow' ? 'bg-danger-500' : 'bg-primary-500'"></div>
            <span class="font-medium">{{ debt.type === 'borrow' ? $t('debts.i_owe') : $t('debts.they_owe') }} {{ debt.counterparty }}</span>
            <span v-if="debt.status === 'paid'" class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{{ $t('debts.status_paid') }}</span>
          </div>
          <span class="text-sm font-bold">{{ formatConverted(debt.remaining, debt.currency) }}</span>
        </div>
        <p class="text-sm text-slate-500 mb-3">{{ debt.name }} <span v-if="debt.due_date">• {{ debt.type === 'borrow' ? $t('debts.due_borrow') : $t('debts.due_lend') }} {{ formatDate(debt.due_date) }}</span></p>
        <div class="flex items-center gap-4 mb-3">
          <div class="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div class="h-full bg-primary-500 rounded-full transition-all" :style="{ width: Math.min((debt.paid_amount / debt.amount) * 100, 100) + '%' }"></div>
          </div>
          <span class="text-xs text-slate-500">{{ formatConverted(debt.paid_amount, debt.currency) }} / {{ formatConverted(debt.amount, debt.currency) }}</span>
        </div>
        <div class="flex gap-2">
          <button v-if="debt.status !== 'paid'" @click="openPaymentModal(debt)" class="text-xs px-2 py-1 rounded bg-primary-50 dark:bg-primary-900/20 text-primary-600 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors">{{ $t('debts.pay') }}</button>
          <button @click="openHistory(debt)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">{{ $t('debts.history') }}</button>
          <button @click="deleteDebt(debt.id)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors ml-auto">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 relative z-10">
        <h2 class="text-xl font-bold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form @submit.prevent="saveDebt" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.counterparty') }}</label>
            <input v-model="form.counterparty" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.name') }}</label>
            <input v-model="form.name" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('debts.amount') }}</label>
              <input v-model.number="form.amount" type="number" step="0.01" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
              <CurrencySelect v-model="form.currency" required
                :placeholder="$t('common.currency')"
                :search-placeholder="$t('common.search')"
                :empty-text="$t('common.empty')" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.type') }}</label>
            <select v-model="form.type" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
              <option value="borrow">{{ $t('debts.i_owe') }}</option>
              <option value="lend">{{ $t('debts.they_owe') }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.due_date') }}</label>
            <input v-model="form.due_date" type="date" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.account') }}</label>
            <div class="flex gap-2">
              <select v-model="form.account_id" class="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option :value="null">-</option>
                <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" @click="showQuickAccount = true" class="shrink-0 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closeModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Payment Modal -->
    <div v-if="showPaymentModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closePaymentModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6 relative z-10">
        <h2 class="text-xl font-bold mb-4">{{ $t('debts.pay') }}</h2>
        <form @submit.prevent="savePayment" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('debts.pay_amount') }}</label>
              <input v-model.number="paymentForm.amount" type="number" step="0.01" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
              <CurrencySelect v-model="paymentForm.currency" required
                :placeholder="$t('common.currency')"
                :search-placeholder="$t('common.search')"
                :empty-text="$t('common.empty')" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.account') }}</label>
            <select v-model="paymentForm.account_id" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
              <option :value="null">-</option>
              <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.note') }}</label>
            <input v-model="paymentForm.note" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closePaymentModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- History Modal -->
    <div v-if="showHistoryModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeHistoryModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 relative z-10 max-h-[80vh] overflow-y-auto">
        <h2 class="text-xl font-bold mb-4">{{ $t('debts.history') }}</h2>
        <div v-if="!historyDebt && historyPayments.length === 0" class="text-center text-sm text-slate-500 py-8">{{ $t('debts.no_history') }}</div>
        <div v-else class="relative pl-4 border-l-2 border-slate-200 dark:border-slate-700 space-y-6">
          <div v-if="historyDebt" class="relative">
            <div class="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-slate-400 border-2 border-white dark:border-slate-900"></div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">{{ formatConverted(historyDebt.amount, historyDebt.currency) }}</span>
              <span class="text-xs text-slate-400">{{ formatDate(historyDebt.created_at) }}</span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">{{ $t('debts.tx_created') }}</p>
          </div>
          <div v-for="p in historyPayments" :key="p.id" class="relative">
            <div class="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-primary-500 border-2 border-white dark:border-slate-900"></div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">{{ formatConverted(p.amount, p.currency || historyDebt?.currency) }}</span>
              <span class="text-xs text-slate-400">{{ formatDate(p.created_at) }}</span>
            </div>
            <p v-if="p.note" class="text-xs text-slate-500 mt-0.5">{{ p.note }}</p>
            <p v-if="p.account_name" class="text-xs text-slate-500">{{ p.account_name }}</p>
          </div>
        </div>
        <div class="mt-6 flex justify-end">
          <button @click="closeHistoryModal" class="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.close') }}</button>
        </div>
      </div>
    </div>

    <QuickAccountModal v-model="showQuickAccount" @created="onQuickAccountCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useDebtsStore } from '../stores/debts'
import { useAccountsStore } from '../stores/accounts'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import { getUserLocale } from '@/utils/locale'
import QuickAccountModal from '../components/QuickAccountModal.vue'
import CurrencySelect from '../components/CurrencySelect.vue'

const { t } = useI18n()
const undo = useUndo()
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveDebt() },
  'esc': () => { if (showModal.value) closeModal() }
})
const debtsStore = useDebtsStore()
const accountsStore = useAccountsStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const showPaymentModal = ref(false)
const showHistoryModal = ref(false)
const showQuickAccount = ref(false)
const isEditing = ref(false)
const currentDebtId = ref(null)
const historyPayments = ref([])
const historyDebt = ref(null)
const form = reactive({ name: '', counterparty: '', amount: 0, currency: '', type: 'borrow', due_date: '', description: '', account_id: null })
const paymentForm = reactive({ amount: 0, currency: '', note: '', account_id: null })

onMounted(() => {
  debtsStore.fetchDebts()
  accountsStore.fetchAccounts()
})

function formatConverted(value, currency) {
  return ratesStore.formatConverted(value, currency || baseCurrency.value)
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(getUserLocale())
}

function openModal() {
  isEditing.value = false
  Object.assign(form, { name: '', counterparty: '', amount: 0, currency: baseCurrency.value, type: 'borrow', due_date: '', description: '', account_id: null })
  showModal.value = true
}

function openPaymentModal(debt) {
  currentDebtId.value = debt.id
  paymentForm.amount = debt.remaining
  paymentForm.currency = debt.currency || baseCurrency.value
  paymentForm.note = ''
  paymentForm.account_id = debt.account_id || accountsStore.accounts[0]?.id || null
  showPaymentModal.value = true
}

function closeModal() {
  showModal.value = false
}

function closePaymentModal() {
  showPaymentModal.value = false
}

function closeHistoryModal() {
  showHistoryModal.value = false
}

function onQuickAccountCreated(account) {
  form.account_id = account.id
}

async function saveDebt() {
  if (isEditing.value) {
    await debtsStore.updateDebt(form.id, { ...form })
  } else {
    await debtsStore.createDebt({ ...form })
  }
  closeModal()
}

async function savePayment() {
  await debtsStore.addPayment(currentDebtId.value, { ...paymentForm })
  closePaymentModal()
}

async function deleteDebt(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const item = debtsStore.debts.find(d => d.id === id)
  await debtsStore.deleteDebt(id)
  if (item) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await debtsStore.createDebt({ ...item })
      }
    })
  }
}

async function openHistory(debt) {
  historyDebt.value = debt
  const payments = await debtsStore.getPayments(debt.id)
  historyPayments.value = payments
  showHistoryModal.value = true
}
</script>
