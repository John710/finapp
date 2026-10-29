<template>
  <div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('recurring.title') }}</h1>
      <div class="flex gap-2 self-start">
        <router-link to="/recurring/calendar" class="px-4 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2">
          <Icon name="calendar" class="w-4 h-4" />
          {{ $t('nav.calendar') }}
        </router-link>
        <button class="bg-primary-500 hover:bg-primary-600 shadow-card text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors" @click="openModal()">
          <Icon name="plus" class="w-4 h-4" />
          {{ $t('common.add') }}
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-card dark:shadow-card-dark mb-4 flex flex-wrap gap-3">
      <input v-model="filters.search" type="text" :placeholder="$t('common.search') + '...'" :aria-label="$t('common.search')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm w-full lg:w-52 focus:outline-none focus:ring-2 focus:ring-primary-400" />
      <select v-model="filters.status" :aria-label="$t('recurring.filters.status')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('recurring.filters.status') }}</option>
        <option v-for="status in statuses" :key="status" :value="status">{{ $t('recurring.status.' + status) }}</option>
      </select>
      <select v-model="filters.type" :aria-label="$t('common.type')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('common.type') }}</option>
        <option value="income">{{ $t('categories.types.income') }}</option>
        <option value="expense">{{ $t('categories.types.expense') }}</option>
      </select>
      <select v-model="filters.account_id" :aria-label="$t('accounts.title')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('accounts.title') }}</option>
        <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
      </select>
      <select v-model="filters.category_id" :aria-label="$t('categories.title')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
        <option value="">{{ $t('categories.title') }}</option>
        <option v-for="cat in categoriesStore.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
      </select>
      <select v-model="filters.sort" :aria-label="$t('recurring.sorts.label')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
        <option value="next">{{ $t('recurring.sorts.next') }}</option>
        <option value="amount">{{ $t('recurring.sorts.amount') }}</option>
        <option value="name">{{ $t('recurring.sorts.name') }}</option>
      </select>
      <div class="flex items-center gap-2 ml-auto">
        <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button v-for="mode in amountModes" :key="mode" type="button" :aria-pressed="amountMode === mode" class="px-2.5 py-1 rounded-md text-xs font-medium border-0 transition-colors" :class="amountMode === mode ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100' : 'bg-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'" @click="amountMode = mode">
            {{ $t('recurring.amount_modes.' + mode) }}
          </button>
        </div>
        <button class="px-3 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300" @click="resetFilters">
          {{ $t('common.reset_filters') }}
        </button>
      </div>
    </div>

    <div v-if="recurringStore.loading" class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-5 space-y-4">
      <div v-for="i in 4" :key="i" class="flex items-center gap-4">
        <BaseSkeleton height="2.5rem" width="2.5rem" />
        <div class="flex-1 space-y-2">
          <BaseSkeleton height="0.8rem" width="55%" />
          <BaseSkeleton height="0.6rem" width="35%" />
        </div>
        <BaseSkeleton height="1rem" width="5rem" />
      </div>
    </div>

    <div v-else-if="recurringStore.rules.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('recurring.empty') }}</p>
    </div>

    <div v-else-if="visibleRules.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('common.empty') }}</p>
    </div>

    <div v-else class="space-y-3">
      <div v-for="rule in visibleRules" :key="rule.id" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark" :class="{ 'opacity-60': rule.status === 'paused' || rule.status === 'finished' }">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-4 min-w-0">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :class="rule.type === 'income' ? 'bg-primary-100 text-primary-600' : 'bg-danger-100 text-danger-600'">
              <Icon name="repeat" class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-medium truncate">{{ ruleTitle(rule) }}</p>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-medium" :class="statusClass(rule.status)">{{ $t('recurring.status.' + rule.status) }}</span>
              </div>
              <p class="text-sm text-slate-500">{{ amount(rule) }} • {{ rule.account_name }}<template v-if="rule.category_name"> • {{ rule.category_name }}</template> • {{ schedule(rule) }}</p>
              <p class="text-xs text-slate-400">
                <template v-if="rule.status === 'overdue'">{{ $t('recurring.due') }}: {{ formatDate(rule.due_date) }}</template>
                <template v-else>{{ $t('recurring.next') }}: {{ formatDate(rule.next_occurrence || rule.next_date) }}</template>
                <template v-if="rule.occurrences_paid"> • {{ $t('recurring.paid_count', { count: rule.occurrences_paid }) }}</template>
                <template v-if="!rule.is_owner"> • @{{ rule.owner_login }}</template>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button class="text-xs px-2 py-1 rounded-full border-0 flex items-center gap-1 transition-colors font-medium" :class="rule.is_shared ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-500/30' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'" @click="openShare(rule)">
              <Icon name="share" class="w-3 h-3" />{{ rule.is_shared ? $t('sharing.shared_badge') : $t('sharing.title') }}
            </button>
            <button class="text-xs px-2 py-1 rounded border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" @click="editRule(rule)">{{ $t('common.edit') }}</button>
            <button class="w-11 h-6 rounded-full relative transition-colors border-0" :class="rule.is_active ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'" role="switch" :aria-checked="!!rule.is_active" :aria-label="$t('recurring.toggle_active')" :disabled="busy === rule.id" @click="toggleActive(rule)">
              <span class="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all" :class="rule.is_active ? 'right-1' : 'left-1'"></span>
            </button>
            <button class="p-2 text-slate-400 hover:text-danger-500 transition-colors border-0 bg-transparent disabled:opacity-50" :disabled="deleting" :aria-label="$t('common.delete')" @click="deleteRule(rule.id)">
              <Icon name="delete" class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div v-if="rule.is_owner && rule.due_date && rule.status !== 'finished'" class="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex-wrap">
          <button class="text-xs px-3 py-1.5 rounded-full border-0 bg-primary-500 hover:bg-primary-600 text-white font-medium transition-colors flex items-center gap-1" :disabled="busy === rule.id" @click="pay(rule)">
            <Icon name="check" class="w-3 h-3" />{{ $t('recurring.actions.pay') }}
          </button>
          <button class="text-xs px-3 py-1.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium transition-colors flex items-center gap-1" :disabled="busy === rule.id" @click="skip(rule)">
            <Icon name="cancel" class="w-3 h-3" />{{ $t('recurring.actions.skip') }}
          </button>
          <button class="text-xs px-3 py-1.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium transition-colors flex items-center gap-1" :disabled="busy === rule.id" @click="runNow(rule)">
            <Icon name="repeat" class="w-3 h-3" />{{ $t('recurring.actions.run_now') }}
          </button>
          <span class="text-xs text-slate-400">{{ formatDate(rule.due_date) }}</span>
          <button class="text-xs px-3 py-1.5 rounded-full border-0 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 font-medium transition-colors flex items-center gap-1 ml-auto" @click="openHistory(rule)">
            <Icon name="clock" class="w-3 h-3" />{{ $t('recurring.actions.history') }}
          </button>
        </div>
        <div v-else-if="rule.status !== 'finished'" class="flex items-center mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button class="text-xs px-3 py-1.5 rounded-full border-0 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 font-medium transition-colors flex items-center gap-1" @click="openHistory(rule)">
            <Icon name="clock" class="w-3 h-3" />{{ $t('recurring.actions.history') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <BaseModal v-model="showModal" width-class="max-w-lg">
        <h2 class="font-display text-xl font-semibold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form class="space-y-4" @submit.prevent="saveRule">
          <div>
            <span :id="`${uid}-type`" class="block text-sm font-medium mb-1">{{ $t('common.type') }}</span>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg" role="group" :aria-labelledby="`${uid}-type`">
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors border-0" :aria-pressed="form.type === 'expense'" :class="form.type === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-danger-500' : 'bg-transparent text-slate-500'" @click="form.type = 'expense'">{{ $t('categories.types.expense') }}</button>
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors border-0" :aria-pressed="form.type === 'income'" :class="form.type === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500' : 'bg-transparent text-slate-500'" @click="form.type = 'income'">{{ $t('categories.types.income') }}</button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label :for="`${uid}-amount`" class="block text-sm font-medium mb-1">{{ $t('recurring.amount') }}</label>
              <input :id="`${uid}-amount`" v-model.number="form.amount" type="number" step="0.01" min="0" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
            </div>
            <div>
              <span class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</span>
              <!-- A rule is booked in its account's currency, so the account decides it. -->
              <div class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400" :title="$t('recurring.currency_from_account')">
                {{ form.currency || '—' }}
              </div>
              <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{{ $t('recurring.currency_from_account') }}</p>
            </div>
          </div>
          <div>
            <label :for="`${uid}-account`" class="block text-sm font-medium mb-1">{{ $t('accounts.title') }}</label>
            <div class="flex gap-2">
              <select :id="`${uid}-account`" v-model="form.account_id" required class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
                <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')" :aria-label="$t('common.add')" @click="showQuickAccount = true">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div>
            <label :for="`${uid}-category`" class="block text-sm font-medium mb-1">{{ $t('categories.title') }}</label>
            <div class="flex gap-2">
              <select :id="`${uid}-category`" v-model="form.category_id" class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
                <option :value="null">-</option>
                <option v-for="cat in filteredCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
              <button type="button" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')" :aria-label="$t('common.add')" @click="showQuickCategory = true">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>

          <p class="font-display text-sm font-semibold pt-2 border-t border-slate-100 dark:border-slate-800">{{ $t('recurring.schedule') }}</p>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label :for="`${uid}-interval`" class="block text-sm font-medium mb-1">{{ $t('recurring.interval.label') }}</label>
              <div class="flex gap-2">
                <input :id="`${uid}-interval`" v-model.number="form.interval_value" type="number" min="1" max="100" required class="w-20 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
                <select v-model="form.interval_unit" :aria-label="$t('recurring.interval.label')" class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100" @change="onUnitChange">
                  <option v-for="unit in units" :key="unit" :value="unit">{{ $t('recurring.interval.units.' + unit) }}</option>
                </select>
              </div>
            </div>
            <div>
              <label :for="`${uid}-anchor`" class="block text-sm font-medium mb-1">{{ $t('recurring.interval.anchor_day') }}</label>
              <input :id="`${uid}-anchor`" v-model.number="form.billing_anchor_day" type="number" min="1" max="31" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" @input="anchorTouched = true" />
              <p class="text-xs text-slate-400 mt-1">{{ $t('recurring.interval.anchor_hint') }}</p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label :for="`${uid}-start`" class="block text-sm font-medium mb-1">{{ $t('recurring.fields.start_date') }}</label>
              <input :id="`${uid}-start`" v-model="form.start_date" type="date" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" @input="onStartChange" />
            </div>
            <div>
              <label :for="`${uid}-end`" class="block text-sm font-medium mb-1">{{ $t('recurring.fields.end_date') }}</label>
              <input :id="`${uid}-end`" v-model="form.end_date" type="date" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label :for="`${uid}-limit`" class="block text-sm font-medium mb-1">{{ $t('recurring.fields.payment_limit') }}</label>
              <input :id="`${uid}-limit`" v-model.number="form.payment_limit" type="number" min="1" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" :placeholder="$t('recurring.fields.unlimited')" />
            </div>
            <div>
              <label :for="`${uid}-notify`" class="block text-sm font-medium mb-1">{{ $t('recurring.fields.notify_days_before') }}</label>
              <input :id="`${uid}-notify`" v-model.number="form.notify_days_before" type="number" min="0" max="90" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="form.auto_renew" type="checkbox" class="w-4 h-4 rounded" />
            {{ $t('recurring.fields.auto_renew') }}
          </label>
          <div>
            <label :for="`${uid}-note`" class="block text-sm font-medium mb-1">{{ $t('transactions.note') }}</label>
            <input :id="`${uid}-note`" v-model="form.note" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closeModal">{{ $t('common.cancel') }}</button>
            <button type="submit" :disabled="saving" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{{ $t('common.save') }}</button>
          </div>
        </form>
      </BaseModal>

    <RecurringHistoryModal v-model="historyState.show" :rule="historyState.rule" />

    <ShareModal v-model="shareState.show" entity-type="recurring" :entity-id="shareState.id" :entity-label="shareState.label" @saved="recurringStore.fetchRules()" />
    <QuickAccountModal v-model="showQuickAccount" @created="onQuickAccountCreated" />
    <QuickCategoryModal v-model="showQuickCategory" :default-type="form.type" @created="onQuickCategoryCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed, watch, useId } from 'vue'
import { useRecurringStore } from '../stores/recurring'
import { useAccountsStore } from '../stores/accounts'
import { useCategoriesStore } from '../stores/categories'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useHotkeys } from '@/composables/useHotkeys'
import { useUndo } from '@/composables/useUndo'
import { formatDate as formatDateValue, parseAmount } from '@/utils/format'
import { logger } from '@/utils/logger'
import { scheduleLabel } from '@/utils/recurring'
import QuickAccountModal from '../components/QuickAccountModal.vue'
import QuickCategoryModal from '../components/QuickCategoryModal.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'
import ShareModal from '@/components/ShareModal.vue'
import RecurringHistoryModal from '@/components/RecurringHistoryModal.vue'

// Writable schedule fields — a PATCH only sends the ones the user actually changed,
// so an amount edit cannot overwrite a stale next_date or schedule.
const EDITABLE_FIELDS = [
  'type', 'amount', 'currency', 'account_id', 'category_id', 'note',
  'interval_unit', 'interval_value', 'billing_anchor_day', 'start_date', 'end_date',
  'auto_renew', 'payment_limit', 'notify_days_before'
]
const NUMERIC_FIELDS = ['amount', 'payment_limit']

const { t } = useI18n()
const uid = useId()
const undo = useUndo('recurring')
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveRule() },
  'esc': () => { if (showModal.value) closeModal() }
})
const recurringStore = useRecurringStore()
const shareState = ref({ show: false, id: null, label: '' })
const historyState = ref({ show: false, rule: null })

function openShare(rule) {
  shareState.value = { show: true, id: rule.id, label: ruleTitle(rule) }
}

function openHistory(rule) {
  historyState.value = { show: true, rule }
}

const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const showQuickAccount = ref(false)
const showQuickCategory = ref(false)
const isEditing = ref(false)
const busy = ref(null)
const saving = ref(false)
const deleting = ref(false)
const anchorTouched = ref(false)
const editing = ref(null)

const statuses = ['scheduled', 'due_today', 'overdue', 'paused', 'finished']
const units = ['day', 'week', 'month', 'year']
const amountModes = ['occurrence', 'monthly', 'yearly']
const amountMode = ref('monthly')

function todayValue() {
  return new Date().toLocaleDateString('sv-SE')
}

const form = reactive(blankForm())
const filters = reactive({ search: '', status: '', type: '', account_id: '', category_id: '', sort: 'next' })

function blankForm() {
  return {
    type: 'expense', amount: 0, currency: '', account_id: null, category_id: null, note: '',
    interval_unit: 'month', interval_value: 1, billing_anchor_day: null,
    start_date: todayValue(), end_date: '', auto_renew: true, payment_limit: null,
    notify_days_before: 0, is_active: true
  }
}

onMounted(() => {
  recurringStore.fetchRules()
  accountsStore.fetchAccounts()
  categoriesStore.fetchCategories()
})

const filteredCategories = computed(() => categoriesStore.categories.filter(c => c.type === form.type))

// The server books a rule in its account's currency and rejects any other, so
// the currency follows the selected account. Editing a rule saved before that
// rule existed relabels it with the currency it was always booked in.
const accountCurrency = computed(() =>
  accountsStore.accounts.find(acc => String(acc.id) === String(form.account_id))?.currency || ''
)
watch(accountCurrency, currency => {
  if (currency) form.currency = currency
}, { immediate: true })

const visibleRules = computed(() => {
  const query = filters.search.trim().toLowerCase()
  const rows = recurringStore.rules.filter(rule => {
    if (filters.status && rule.status !== filters.status) return false
    if (filters.type && rule.type !== filters.type) return false
    if (filters.account_id && String(rule.account_id) !== String(filters.account_id)) return false
    if (filters.category_id && String(rule.category_id) !== String(filters.category_id)) return false
    if (query && !(`${ruleTitle(rule)} ${rule.account_name || ''} ${rule.category_name || ''}`.toLowerCase().includes(query))) return false
    return true
  })
  return rows.sort((a, b) => {
    if (filters.sort === 'amount') return equivalent(b) - equivalent(a)
    if (filters.sort === 'name') return ruleTitle(a).localeCompare(ruleTitle(b))
    return String(a.due_date || a.next_date).localeCompare(String(b.due_date || b.next_date))
  })
})

function ruleTitle(rule) {
  return rule.note || (rule.type === 'income' ? t('recurring.income') : t('recurring.expense'))
}

function statusClass(status) {
  return {
    overdue: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
    due_today: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    paused: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    finished: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
  }[status] || 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
}

// The API answers with the monthly figure; a year is twelve of those.
function equivalent(rule) {
  if (amountMode.value === 'occurrence') return parseAmount(rule.amount)
  const monthly = parseAmount(rule.monthly_equivalent ?? rule.amount)
  return amountMode.value === 'yearly' ? monthly * 12 : monthly
}

function amount(rule) {
  if (amountMode.value === 'occurrence') return formatConverted(rule.amount, rule.currency)
  return `${formatConverted(equivalent(rule), rule.currency)} ${t('recurring.period.' + amountMode.value)}`
}

function formatConverted(value, currency) {
  return ratesStore.formatConverted(value, currency || baseCurrency.value)
}

function formatDate(date) {
  return date ? formatDateValue(date) : '—'
}

function schedule(rule) {
  return scheduleLabel(t, rule)
}

function onStartChange() {
  if (!anchorTouched.value && form.start_date) {
    form.billing_anchor_day = Number(form.start_date.slice(8, 10))
  }
}

function onUnitChange() {
  if (!anchorTouched.value && form.interval_unit === 'month') onStartChange()
  if (form.interval_unit === 'day' || form.interval_unit === 'week') form.billing_anchor_day = null
}

function valueOf(source, key) {
  let value = source[key]
  if (value instanceof Date) value = value.toLocaleDateString('sv-SE')
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) value = value.split('T')[0]
  if (value === '' || value === undefined) return null
  if (NUMERIC_FIELDS.includes(key)) return value === null ? null : parseAmount(value)
  return value
}

function sameValue(a, b) {
  if (a === null || b === null) return a === b
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a) === String(b)
}

function buildPayload() {
  const payload = {}
  for (const key of EDITABLE_FIELDS) {
    const value = valueOf(form, key)
    if (isEditing.value && sameValue(value, valueOf(editing.value || {}, key))) continue
    payload[key] = value
  }
  if (!anchorTouched.value && payload.start_date) {
    payload.billing_anchor_day = Number(String(payload.start_date).slice(8, 10))
  }
  return payload
}

function resetFilters() {
  Object.assign(filters, { search: '', status: '', type: '', account_id: '', category_id: '', sort: 'next' })
}

function openModal() {
  isEditing.value = false
  editing.value = null
  anchorTouched.value = false
  Object.assign(form, blankForm(), { account_id: accountsStore.accounts[0]?.id || null })
  form.currency = accountCurrency.value
  form.billing_anchor_day = Number(form.start_date.slice(8, 10))
  showModal.value = true
}

function editRule(rule) {
  isEditing.value = true
  editing.value = rule
  anchorTouched.value = rule.billing_anchor_day != null
  Object.assign(form, blankForm())
  for (const key of EDITABLE_FIELDS) {
    const value = valueOf(rule, key)
    if (value !== null) form[key] = value
  }
  // A date input shows an empty field only for the empty string, not for null.
  form.end_date = valueOf(rule, 'end_date') ?? ''
  // The watcher does not fire when the account stays the same as last time.
  if (accountCurrency.value) form.currency = accountCurrency.value
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function onQuickAccountCreated(account) {
  form.account_id = account.id
}

function onQuickCategoryCreated(category) {
  form.category_id = category.id
}

async function saveRule() {
  // Re-entry guard: double click / Ctrl+Enter while a request is in flight
  if (saving.value) return
  saving.value = true
  try {
    form.amount = parseAmount(form.amount)
    const payload = buildPayload()
    if (isEditing.value) {
      if (!Object.keys(payload).length) {
        closeModal()
        return
      }
      await recurringStore.patchRule(editing.value.id, payload)
    } else {
      await recurringStore.createRule(payload)
    }
    window.$toast?.success(t('common.saved'))
    closeModal()
  } catch (e) {
    logger.error('Failed to save recurring rule', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

function toggleActive(rule) {
  return withBusy(rule, () => recurringStore.patchRule(rule.id, { is_active: !rule.is_active }))
}

async function withBusy(rule, work) {
  if (busy.value !== null) return
  busy.value = rule.id
  try {
    await work()
  } catch (err) {
    window.$toast?.error(err.message)
  } finally {
    busy.value = null
  }
}

function pay(rule) {
  return withBusy(rule, async () => {
    await recurringStore.payOccurrence({ ruleId: rule.id, date: rule.due_date })
    window.$toast?.success(t('recurring.paid_toast', { date: formatDate(rule.due_date) }))
  })
}

function skip(rule) {
  return withBusy(rule, async () => {
    await recurringStore.skipOccurrence({ ruleId: rule.id, date: rule.due_date })
    window.$toast?.success(t('recurring.skipped_toast', { date: formatDate(rule.due_date) }))
  })
}

function runNow(rule) {
  return withBusy(rule, async () => {
    await recurringStore.runNow(rule.id)
    window.$toast?.success(t('recurring.ran_toast'))
  })
}

async function deleteRule(id) {
  if (deleting.value) return
  if (!(await window.$confirm({ message: t('common.confirm_delete'), danger: true }))) return
  const item = recurringStore.rules.find(r => r.id === id)
  deleting.value = true
  try {
    await recurringStore.deleteRule(id)
    if (item) {
      const snapshot = {}
      for (const key of EDITABLE_FIELDS) snapshot[key] = valueOf(item, key)
      undo.push({
        message: t('common.undo_delete'),
        action: async () => {
          try {
            await recurringStore.createRule(snapshot)
          } catch (e) {
            logger.error('Failed to restore recurring rule', e)
            window.$toast?.error(e.message || t('common.error'))
          }
        }
      })
    }
  } catch (e) {
    logger.error('Failed to delete recurring rule', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    deleting.value = false
  }
}
</script>
