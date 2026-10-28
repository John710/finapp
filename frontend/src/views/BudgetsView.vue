<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('budgets.title') }}</h1>
      <button class="bg-primary-500 hover:bg-primary-600 shadow-card text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors" @click="openModal()">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="budgetsStore.loading" class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-5 space-y-4">
      <div v-for="i in 4" :key="i" class="flex items-center gap-4">
        <BaseSkeleton height="2.5rem" width="2.5rem" />
        <div class="flex-1 space-y-2">
          <BaseSkeleton height="0.8rem" width="55%" />
          <BaseSkeleton height="0.6rem" width="35%" />
        </div>
        <BaseSkeleton height="1rem" width="6rem" />
      </div>
    </div>

    <div v-else-if="budgetsStore.budgets.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('budgets.empty') }}</p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="b in budgetsStore.budgets" :key="b.id" class="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-card dark:shadow-card-dark">
        <div class="flex items-center justify-between mb-3 gap-2">
          <div class="flex flex-wrap items-center gap-1 min-w-0">
            <span v-if="b.category_name" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :style="{ backgroundColor: b.category_color + '20', color: b.category_color }">
              {{ b.category_name }}
            </span>
            <span v-for="tag in b.tags || []" :key="tag.id" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :style="{ backgroundColor: (tag.color || '#94a3b8') + '20', color: tag.color || '#94a3b8' }">
              #{{ tag.name }}
            </span>
          </div>
          <Icon v-if="b.user_id === auth.user?.id && b.is_shared !== undefined" name="share" class="w-3 h-3 text-primary-400" />
          <span class="text-xs text-slate-500 whitespace-nowrap">{{ b.period === 'month' ? $t('budgets.period_month') : $t('budgets.period_week') }}</span>
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
        <div class="mt-4 flex gap-2 items-center">
          <span v-if="b.owner_login" class="text-xs text-primary-500 mr-auto">@{{ b.owner_login }}</span>
          <button class="text-xs px-2 py-1 rounded-full border-0 flex items-center gap-1 transition-colors font-medium" :class="b.is_shared ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-500/30' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'" @click="openShare(b)">
            <Icon name="share" class="w-3 h-3" />{{ b.is_shared ? $t('sharing.shared_badge') : $t('sharing.title') }}
          </button>
          <button class="text-xs px-2 py-1 rounded border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" @click="editBudget(b)">{{ $t('common.edit') }}</button>
          <button class="text-xs px-2 py-1 rounded border-0 bg-slate-100 dark:bg-slate-800 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors" @click="deleteBudget(b.id)">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <BaseModal v-model="showModal" width-class="max-w-md">
        <h2 class="font-display text-xl font-semibold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form class="space-y-4" @submit.prevent="saveBudget">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.category_id" class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
                <option :value="null">{{ $t('budgets.no_category') }}</option>
                <option v-for="cat in expenseCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
              <button type="button" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')" @click="showQuickCategory = true">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
            <p class="text-xs text-slate-500 mt-1">{{ $t('budgets.target_hint') }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('tags.title') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <button
v-for="tag in tagsStore.tags" :key="tag.id" type="button" class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                :class="form.tag_ids.includes(tag.id) ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
                @click="toggleTag(tag.id)">
                {{ tag.name }}
              </button>
              <span v-if="tagsStore.tags.length === 0" class="text-xs text-slate-500">{{ $t('tags.empty_list') }}</span>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('budgets.amount') }}</label>
            <input v-model.number="form.amount" type="number" step="0.01" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
            <CurrencySelect
v-model="form.currency" required
              :placeholder="$t('common.currency')"
              :search-placeholder="$t('common.search')"
              :empty-text="$t('common.empty')" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('budgets.period') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.period === 'month' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'" @click="form.period = 'month'">{{ $t('budgets.period_month') }}</button>
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.period === 'week' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600' : 'text-slate-500'" @click="form.period = 'week'">{{ $t('budgets.period_week') }}</button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closeModal">{{ $t('common.cancel') }}</button>
            <button type="submit" :disabled="saving" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{{ $t('common.save') }}</button>
          </div>
        </form>
      </BaseModal>

    <ShareModal v-model="shareState.show" entity-type="budget" :entity-id="shareState.id" :entity-label="shareState.label" @saved="budgetsStore.fetchBudgets()" />
    <QuickCategoryModal v-model="showQuickCategory" default-type="expense" @created="onQuickCategoryCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useBudgetsStore } from '../stores/budgets'
import { useCategoriesStore } from '../stores/categories'
import { useTagsStore } from '../stores/tags'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import QuickCategoryModal from '../components/QuickCategoryModal.vue'
import CurrencySelect from '../components/CurrencySelect.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'
import ShareModal from '@/components/ShareModal.vue'
import { useAuthStore } from '../stores/auth'
import { parseAmount } from '@/utils/format'
import { logger } from '@/utils/logger.js'

const { t } = useI18n()
const undo = useUndo('budgets')
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveBudget() },
  'esc': () => { if (showModal.value) closeModal() }
})
const budgetsStore = useBudgetsStore()
const categoriesStore = useCategoriesStore()
const tagsStore = useTagsStore()
const auth = useAuthStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const showQuickCategory = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const form = reactive({ category_id: null, tag_ids: [], amount: 0, currency: '', period: 'month' })

onMounted(() => {
  budgetsStore.fetchBudgets()
  categoriesStore.fetchCategories()
  tagsStore.fetchTags()
})

const shareState = ref({ show: false, id: null, label: '' })

function openShare(b) {
  shareState.value = { show: true, id: b.id, label: b.category_name || t('budgets.title') }
}

function toggleTag(tagId) {
  const idx = form.tag_ids.indexOf(tagId)
  if (idx === -1) form.tag_ids.push(tagId)
  else form.tag_ids.splice(idx, 1)
}

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
  Object.assign(form, { category_id: expenseCategories.value[0]?.id || null, tag_ids: [], amount: 0, currency: baseCurrency.value, period: 'month' })
  showModal.value = true
}

function editBudget(budget) {
  isEditing.value = true
  Object.assign(form, { ...budget, tag_ids: (budget.tags || []).map(tag => tag.id) })
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function onQuickCategoryCreated(category) {
  form.category_id = category.id
}

async function saveBudget() {
  form.amount = parseAmount(form.amount)
  if (!form.category_id && form.tag_ids.length === 0) {
    window.$toast?.error(t('budgets.target_required'))
    return
  }
  const payload = { category_id: form.category_id || null, tag_ids: [...form.tag_ids], amount: form.amount, currency: form.currency, period: form.period, start_date: form.start_date, is_active: form.is_active !== false }
  // Re-entry guard: double click / Ctrl+Enter while a request is in flight
  if (saving.value) return
  saving.value = true
  try {
    if (isEditing.value) {
      await budgetsStore.updateBudget(form.id, payload)
    } else {
      await budgetsStore.createBudget(payload)
    }
    closeModal()
  } catch (e) {
    logger.error('Failed to save budget', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

async function deleteBudget(id) {
  if (deleting.value) return
  if (!(await window.$confirm({ message: t('common.confirm_delete'), danger: true }))) return
  const item = budgetsStore.budgets.find(b => b.id === id)
  deleting.value = true
  try {
    await budgetsStore.deleteBudget(id)
    if (item) {
      undo.push({
        message: t('common.undo_delete'),
        action: async () => {
          try {
            await budgetsStore.createBudget({ ...item })
          } catch (e) {
            logger.error('Failed to restore budget', e)
            window.$toast?.error(e.message || t('common.error'))
          }
        }
      })
    }
  } catch (e) {
    logger.error('Failed to delete budget', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    deleting.value = false
  }
}
</script>
