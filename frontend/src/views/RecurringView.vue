<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ $t('recurring.title') }}</h1>
      <button @click="openModal()" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="recurringStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="recurringStore.rules.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('recurring.empty') }}</p>
    </div>

    <div v-else class="space-y-3">
      <div v-for="rule in recurringStore.rules" :key="rule.id" class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :class="rule.type === 'income' ? 'bg-primary-100 text-primary-600' : 'bg-danger-100 text-danger-600'">
            <Icon name="repeat" class="w-5 h-5" />
          </div>
          <div>
            <p class="font-medium">{{ rule.note || (rule.type === 'income' ? $t('recurring.income') : $t('recurring.expense')) }}</p>
            <p class="text-sm text-slate-500">{{ formatConverted(rule.amount, rule.currency) }} • {{ rule.account_name }} • {{ $t('recurring.frequencies.' + rule.frequency) }}</p>
            <p class="text-xs text-slate-400">{{ $t('recurring.next') }}: {{ formatDate(rule.next_date) }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button @click="editRule(rule)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">{{ $t('common.edit') }}</button>
          <button @click="toggleActive(rule)" class="w-11 h-6 rounded-full relative transition-colors" :class="rule.is_active ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'">
            <span class="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all" :class="rule.is_active ? 'right-1' : 'left-1'"></span>
          </button>
          <button @click="deleteRule(rule.id)" class="p-2 text-slate-400 hover:text-danger-500 transition-colors">
            <Icon name="delete" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 relative z-10">
        <h2 class="text-xl font-bold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form @submit.prevent="saveRule" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" @click="form.type = 'expense'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-danger-500' : 'text-slate-500'">{{ $t('categories.types.expense') }}</button>
              <button type="button" @click="form.type = 'income'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500' : 'text-slate-500'">{{ $t('categories.types.income') }}</button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('recurring.amount') }}</label>
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
            <label class="block text-sm font-medium mb-1">{{ $t('accounts.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.account_id" required class="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" @click="showQuickAccount = true" class="shrink-0 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div>
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
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('recurring.frequency') }}</label>
            <select v-model="form.frequency" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
              <option v-for="freq in frequencies" :key="freq" :value="freq">{{ $t('recurring.frequencies.' + freq) }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('recurring.next_date') }}</label>
            <input v-model="form.next_date" type="date" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.note') }}</label>
            <input v-model="form.note" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closeModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <QuickAccountModal v-model="showQuickAccount" @created="onQuickAccountCreated" />
    <QuickCategoryModal v-model="showQuickCategory" :default-type="form.type" @created="onQuickCategoryCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useRecurringStore } from '../stores/recurring'
import { useAccountsStore } from '../stores/accounts'
import { useCategoriesStore } from '../stores/categories'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useHotkeys } from '@/composables/useHotkeys'
import { useUndo } from '@/composables/useUndo'
import { getUserLocale } from '@/utils/locale'
import QuickAccountModal from '../components/QuickAccountModal.vue'
import QuickCategoryModal from '../components/QuickCategoryModal.vue'
import CurrencySelect from '../components/CurrencySelect.vue'

const { t } = useI18n()
const undo = useUndo()
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveRule() },
  'esc': () => { if (showModal.value) closeModal() }
})
const recurringStore = useRecurringStore()
const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const showQuickAccount = ref(false)
const showQuickCategory = ref(false)
const isEditing = ref(false)
const form = reactive({ type: 'expense', amount: 0, currency: '', account_id: null, category_id: null, frequency: 'monthly', next_date: new Date().toLocaleDateString('sv-SE'), note: '', is_active: true })

const frequencies = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly']

onMounted(() => {
  recurringStore.fetchRules()
  accountsStore.fetchAccounts()
  categoriesStore.fetchCategories()
})

const filteredCategories = computed(() => categoriesStore.categories.filter(c => c.type === form.type))

function formatConverted(value, currency) {
  return ratesStore.formatConverted(value, currency || baseCurrency.value)
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(getUserLocale())
}

function openModal() {
  isEditing.value = false
  Object.assign(form, { type: 'expense', amount: 0, currency: baseCurrency.value, account_id: accountsStore.accounts[0]?.id || null, category_id: null, frequency: 'monthly', next_date: new Date().toLocaleDateString('sv-SE'), note: '', is_active: true })
  showModal.value = true
}

function editRule(rule) {
  isEditing.value = true
  Object.assign(form, rule)
  if (form.next_date instanceof Date) {
    form.next_date = new Date(form.next_date).toLocaleDateString('sv-SE')
  } else if (typeof form.next_date === 'string' && form.next_date.includes('T')) {
    form.next_date = form.next_date.split('T')[0]
  }
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
  if (isEditing.value) {
    await recurringStore.updateRule(form.id, { ...form })
  } else {
    await recurringStore.createRule({ ...form })
  }
  window.$toast?.success(t('common.saved'))
  closeModal()
}

async function toggleActive(rule) {
  await recurringStore.updateRule(rule.id, { ...rule, is_active: !rule.is_active })
}

async function deleteRule(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const item = recurringStore.rules.find(r => r.id === id)
  await recurringStore.deleteRule(id)
  if (item) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await recurringStore.createRule({ ...item })
      }
    })
  }
}
</script>
