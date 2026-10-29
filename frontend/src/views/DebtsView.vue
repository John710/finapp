<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('debts.title') }}</h1>
      <button class="bg-primary-500 hover:bg-primary-600 shadow-card text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors" @click="openModal()">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="debtsStore.loading" class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-5 space-y-4">
      <div v-for="i in 4" :key="i" class="flex items-center gap-4">
        <BaseSkeleton height="2.5rem" width="2.5rem" />
        <div class="flex-1 space-y-2">
          <BaseSkeleton height="0.8rem" width="55%" />
          <BaseSkeleton height="0.6rem" width="35%" />
        </div>
        <BaseSkeleton height="1rem" width="5rem" />
      </div>
    </div>

    <div v-else-if="debtsStore.debts.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('debts.empty') }}</p>
    </div>

    <div v-else class="space-y-4">
      <div v-for="debt in debtsStore.debts" :key="debt.id" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark" :class="{ 'opacity-60': debt.status === 'paid' }">
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
          <button v-if="debt.status !== 'paid'" class="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-500/15 text-primary-600 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors" @click="openPaymentModal(debt)">{{ $t('debts.pay') }}</button>
          <button v-if="!debt.owner_login" class="text-xs px-2 py-1 rounded border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" @click="editDebt(debt)">{{ $t('common.edit') }}</button>
          <button class="text-xs px-2 py-1 rounded border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" @click="openHistory(debt)">{{ $t('debts.history') }}</button>
          <button class="text-xs px-2 py-1 rounded-full border-0 flex items-center gap-1 transition-colors font-medium" :class="debt.is_shared ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-500/30' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'" @click="openShare(debt)">
            <Icon name="share" class="w-3 h-3" />{{ debt.is_shared ? $t('sharing.shared_badge') : $t('sharing.title') }}
          </button>
          <span v-if="debt.owner_login" class="text-xs text-primary-500 ml-auto">@{{ debt.owner_login }}</span>
          <button class="text-xs px-2 py-1 rounded border-0 bg-slate-100 dark:bg-slate-800 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors ml-auto" @click="deleteDebt(debt.id)">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <BaseModal v-model="showModal" width-class="max-w-md">
        <h2 class="font-display text-xl font-semibold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form class="space-y-4" @submit.prevent="saveDebt">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.counterparty') }}</label>
            <input v-model="form.counterparty" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.name') }}</label>
            <input v-model="form.name" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
          </div>
          <p v-if="hasPayments" class="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3 py-2">{{ $t('debts.locked_by_payments') }}</p>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="debt-amount" class="block text-sm font-medium mb-1">{{ $t('debts.amount') }}</label>
              <input id="debt-amount" v-model.number="form.amount" type="number" step="0.01" required :disabled="hasPayments" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 disabled:opacity-60 disabled:cursor-not-allowed" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
              <!-- A disabled fieldset also disables the buttons inside CurrencySelect -->
              <fieldset :disabled="hasPayments" class="min-w-0 border-0 p-0 m-0" :class="hasPayments ? 'opacity-60' : ''">
                <CurrencySelect
v-model="form.currency" required
                  :placeholder="$t('common.currency')"
                  :search-placeholder="$t('common.search')"
                  :empty-text="$t('common.empty')" />
              </fieldset>
            </div>
          </div>
          <div>
            <label for="debt-type" class="block text-sm font-medium mb-1">{{ $t('debts.type') }}</label>
            <select id="debt-type" v-model="form.type" :disabled="hasPayments" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="borrow">{{ $t('debts.i_owe') }}</option>
              <option value="lend">{{ $t('debts.they_owe') }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.due_date') }}</label>
            <input v-model="form.due_date" type="date" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
          </div>
          <div>
            <label for="debt-account" class="block text-sm font-medium mb-1">{{ $t('debts.account') }}</label>
            <div class="flex gap-2">
              <select id="debt-account" v-model="form.account_id" :disabled="hasPayments" class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed">
                <option :value="null">-</option>
                <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" :disabled="hasPayments" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600 disabled:opacity-60" :title="$t('common.add')" :aria-label="$t('common.add')" @click="showQuickAccount = true">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closeModal">{{ $t('common.cancel') }}</button>
            <button type="submit" :disabled="saving" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{{ $t('common.save') }}</button>
          </div>
        </form>
      </BaseModal>

    <!-- Payment Modal -->
    <BaseModal v-model="showPaymentModal" width-class="max-w-sm">
        <h2 class="font-display text-xl font-semibold mb-4">{{ $t('debts.pay') }}</h2>
        <form class="space-y-4" @submit.prevent="savePayment">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('debts.pay_amount') }}</label>
              <input v-model.number="paymentForm.amount" type="number" step="0.01" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
              <CurrencySelect
v-model="paymentForm.currency" required
                :placeholder="$t('common.currency')"
                :search-placeholder="$t('common.search')"
                :empty-text="$t('common.empty')" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('debts.account') }}</label>
            <select v-model="paymentForm.account_id" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
              <option :value="null">-</option>
              <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.note') }}</label>
            <input v-model="paymentForm.note" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closePaymentModal">{{ $t('common.cancel') }}</button>
            <button type="submit" :disabled="saving" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{{ $t('common.save') }}</button>
          </div>
        </form>
      </BaseModal>

    <!-- History Modal -->
    <BaseModal v-model="showHistoryModal" width-class="max-w-md" content-class="max-h-[80vh] overflow-y-auto">
        <h2 class="font-display text-xl font-semibold mb-4">{{ $t('debts.history') }}</h2>
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
          <button class="px-4 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closeHistoryModal">{{ $t('common.close') }}</button>
        </div>
      </BaseModal>

    <ShareModal v-model="shareState.show" entity-type="debt" :entity-id="shareState.id" :entity-label="shareState.label" @saved="debtsStore.fetchDebts()" />
    <QuickAccountModal v-model="showQuickAccount" @created="onQuickAccountCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useDebtsStore } from '../stores/debts'
import { useAccountsStore } from '../stores/accounts'
import { useRatesStore } from '../stores/rates'
import { useAuthStore } from '../stores/auth'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import { formatDate, parseAmount } from '@/utils/format'
import { logger } from '@/utils/logger.js'
import { debtPayload } from '@/utils/debts.js'
import QuickAccountModal from '../components/QuickAccountModal.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'
import ShareModal from '@/components/ShareModal.vue'
import CurrencySelect from '../components/CurrencySelect.vue'

const { t } = useI18n()
const undo = useUndo('debts')
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveDebt() },
  'esc': () => { if (showModal.value) closeModal() }
})
const debtsStore = useDebtsStore()
const shareState = ref({ show: false, id: null, label: '' })

function openShare(debt) {
  shareState.value = { show: true, id: debt.id, label: debt.name }
}
const accountsStore = useAccountsStore()
const ratesStore = useRatesStore()
const authStore = useAuthStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const showPaymentModal = ref(false)
const showHistoryModal = ref(false)
const showQuickAccount = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const opening = ref(false)
const hasPayments = ref(false)
const currentDebtId = ref(null)
const historyPayments = ref([])
const historyDebt = ref(null)
const form = reactive({ id: null, name: '', counterparty: '', amount: 0, currency: '', type: 'borrow', due_date: '', description: '', account_id: null })
const paymentForm = reactive({ amount: 0, currency: '', note: '', account_id: null })

onMounted(() => {
  debtsStore.fetchDebts()
  accountsStore.fetchAccounts()
})

function formatConverted(value, currency) {
  return ratesStore.formatConverted(value, currency || baseCurrency.value)
}

function openModal() {
  isEditing.value = false
  hasPayments.value = false
  Object.assign(form, { id: null, name: '', counterparty: '', amount: 0, currency: baseCurrency.value, type: 'borrow', due_date: '', description: '', account_id: null })
  showModal.value = true
}

// Once a payment exists the server refuses to change amount, currency, type or
// account (409), so the edit form locks those fields up front.
async function editDebt(debt) {
  if (opening.value) return
  opening.value = true
  try {
    const payments = await debtsStore.getPayments(debt.id)
    hasPayments.value = payments.length > 0
    isEditing.value = true
    Object.assign(form, {
      id: debt.id,
      name: debt.name,
      counterparty: debt.counterparty,
      amount: Number(debt.amount),
      currency: debt.currency || baseCurrency.value,
      type: debt.type,
      due_date: debt.due_date ? String(debt.due_date).slice(0, 10) : '',
      description: debt.description || '',
      account_id: debt.account_id ?? null
    })
    showModal.value = true
  } catch (e) {
    logger.error('Failed to load payments', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    opening.value = false
  }
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
  // Re-entry guard: double click / Ctrl+Enter while a request is in flight
  if (saving.value) return
  form.amount = parseAmount(form.amount)
  saving.value = true
  try {
    if (isEditing.value) {
      await debtsStore.updateDebt(form.id, debtPayload(form))
    } else {
      await debtsStore.createDebt(debtPayload(form))
    }
    closeModal()
  } catch (e) {
    logger.error('Failed to save debt', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

async function savePayment() {
  if (saving.value) return
  paymentForm.amount = parseAmount(paymentForm.amount)
  saving.value = true
  try {
    await debtsStore.addPayment(currentDebtId.value, { ...paymentForm })
    closePaymentModal()
  } catch (e) {
    logger.error('Failed to save payment', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

async function deleteDebt(id) {
  if (deleting.value) return
  if (!(await window.$confirm({ message: t('common.confirm_delete'), danger: true }))) return
  const item = debtsStore.debts.find(d => d.id === id)
  deleting.value = true
  try {
    await debtsStore.deleteDebt(id)
    if (item) {
      undo.push({
        message: t('common.undo_delete'),
        action: async () => {
          try {
            await debtsStore.createDebt(debtPayload(item))
          } catch (e) {
            logger.error('Failed to restore debt', e)
            window.$toast?.error(e.message || t('common.error'))
          }
        }
      })
    }
  } catch (e) {
    logger.error('Failed to delete debt', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    deleting.value = false
  }
}

async function openHistory(debt) {
  try {
    const payments = await debtsStore.getPayments(debt.id)
    historyDebt.value = debt
    historyPayments.value = payments
    showHistoryModal.value = true
  } catch (e) {
    logger.error('Failed to load payments', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}
</script>
