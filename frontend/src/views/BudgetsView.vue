<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ $t('budgets.title') }}</h1>
      <button @click="openModal()" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="budgetsStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="budgetsStore.budgets.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('budgets.empty') }}</p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="b in budgetsStore.budgets" :key="b.id" class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :style="{ backgroundColor: b.category_color + '20', color: b.category_color }">
            {{ b.category_name }}
          </span>
          <span class="text-xs text-slate-500">{{ b.period === 'month' ? $t('budgets.period_month') : $t('budgets.period_week') }}</span>
        </div>
        <div class="flex justify-between text-sm mb-2">
          <span class="text-slate-500">{{ formatConverted(b.spent, b.currency) }} / {{ formatConverted(b.amount, b.currency) }}</span>
          <span class="font-medium" :class="progressColor(b.progress)">{{ b.progress }}%</span>
        </div>
        <div class="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all" :class="progressBarColor(b.progress)" :style="{ width: Math.min(b.progress, 100) + '%' }"></div>
        </div>
        <p class="text-xs mt-2" :class="progressColor(b.progress)">
          <span v-if="b.progress >= 100">{{ $t('budgets.exceeded') }}</span>
          <span v-else-if="b.progress >= 80">{{ $t('budgets.warning') }}</span>
          <span v-else>{{ $t('budgets.remaining') }}: {{ formatConverted(b.amount - b.spent, b.currency) }}</span>
        </p>
        <div class="mt-4 flex gap-2">
          <button @click="editBudget(b)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">{{ $t('common.edit') }}</button>
          <button @click="deleteBudget(b.id)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 relative z-10">
        <h2 class="text-xl font-bold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form @submit.prevent="saveBudget" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.category_id" required class="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option v-for="cat in expenseCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
              <button type="button" @click="showQuickCategory = true" class="shrink-0 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('budgets.amount') }}</label>
            <input v-model.number="form.amount" type="number" step="0.01" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
            <CurrencySelect v-model="form.currency" required
              :placeholder="$t('common.currency')"
              :search-placeholder="$t('common.search')"
              :empty-text="$t('common.empty')" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('budgets.period') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" @click="form.period = 'month'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.period === 'month' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'">{{ $t('budgets.period_month') }}</button>
              <button type="button" @click="form.period = 'week'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.period === 'week' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'">{{ $t('budgets.period_week') }}</button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closeModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <QuickCategoryModal v-model="showQuickCategory" default-type="expense" @created="onQuickCategoryCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useBudgetsStore } from '../stores/budgets'
import { useCategoriesStore } from '../stores/categories'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import QuickCategoryModal from '../components/QuickCategoryModal.vue'
import CurrencySelect from '../components/CurrencySelect.vue'

const { t } = useI18n()
const undo = useUndo()
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveBudget() },
  'esc': () => { if (showModal.value) closeModal() }
})
const budgetsStore = useBudgetsStore()
const categoriesStore = useCategoriesStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const showQuickCategory = ref(false)
const isEditing = ref(false)
const form = reactive({ category_id: null, amount: 0, currency: '', period: 'month' })

onMounted(() => {
  budgetsStore.fetchBudgets()
  categoriesStore.fetchCategories()
})

const expenseCategories = computed(() => categoriesStore.categories.filter(c => c.type === 'expense'))

function formatConverted(value, currency) {
  return ratesStore.formatConverted(value, currency || baseCurrency.value)
}

function progressColor(progress) {
  if (progress >= 100) return 'text-danger-500'
  if (progress >= 80) return 'text-warning-600'
  return 'text-primary-600'
}

function progressBarColor(progress) {
  if (progress >= 100) return 'bg-danger-500'
  if (progress >= 80) return 'bg-warning-400'
  return 'bg-primary-500'
}

function openModal() {
  isEditing.value = false
  Object.assign(form, { category_id: expenseCategories.value[0]?.id || null, amount: 0, currency: baseCurrency.value, period: 'month' })
  showModal.value = true
}

function editBudget(budget) {
  isEditing.value = true
  Object.assign(form, budget)
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function onQuickCategoryCreated(category) {
  form.category_id = category.id
}

async function saveBudget() {
  if (isEditing.value) {
    await budgetsStore.updateBudget(form.id, { ...form })
  } else {
    await budgetsStore.createBudget({ ...form })
  }
  closeModal()
}

async function deleteBudget(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const item = budgetsStore.budgets.find(b => b.id === id)
  await budgetsStore.deleteBudget(id)
  if (item) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await budgetsStore.createBudget({ ...item })
      }
    })
  }
}
</script>
