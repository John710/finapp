<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('categories.title') }}</h1>
      <button class="bg-primary-500 hover:bg-primary-600 shadow-card text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors" @click="openModal()">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="categoriesStore.loading" class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-5 space-y-4">
      <div v-for="i in 5" :key="i" class="flex items-center gap-4">
        <BaseSkeleton height="2.5rem" width="2.5rem" />
        <div class="flex-1 space-y-2">
          <BaseSkeleton height="0.8rem" width="55%" />
          <BaseSkeleton height="0.6rem" width="35%" />
        </div>
        <BaseSkeleton height="1rem" width="4rem" />
      </div>
    </div>

    <div v-else-if="categoriesStore.categories.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('categories.empty') }}</p>
    </div>

    <div v-else>
      <div v-for="type in ['income', 'expense']" :key="type" class="mb-8">
        <h3 class="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{{ $t('categories.types.' + type) }}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div
v-for="cat in filteredCategories(type)" :key="cat.id"
            class="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-card dark:shadow-card-dark flex items-center gap-3 transition-shadow"
            :class="isAdmin ? 'hover:shadow-md cursor-pointer' : ''"
            @click="isAdmin && editCategory(cat)">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: cat.color + '20', color: cat.color }">
              <SafeSvg v-if="cat.icon_custom" :svg="cat.icon_custom" class="w-5 h-5" />
              <Icon v-else-if="cat.icon" :name="cat.icon" set="category" class="w-5 h-5" />
              <Icon v-else name="tag" class="w-5 h-5" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="font-medium truncate block">{{ cat.name }}</span>
              <span v-if="cat.parent_id" class="text-xs text-slate-500">{{ parentName(cat.parent_id) }}</span>
            </div>
            <button v-if="isAdmin" class="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-primary-600 transition-colors" :aria-label="$t('categories.merge')" :title="$t('categories.merge')" @click.stop="openMerge(cat)">
              <Icon name="arrowRight" class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Merge modal -->
    <BaseModal v-model="showMerge" width-class="max-w-sm">
      <h2 class="font-display text-xl font-semibold mb-2">{{ $t('categories.merge') }}</h2>
      <p class="text-sm text-slate-500 mb-4">{{ $t('categories.merge_desc', { name: mergeSource?.name || '' }) }}</p>
      <form class="space-y-4" @submit.prevent="confirmMerge">
        <select v-model="mergeTargetId" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
          <option :value="null" disabled>-</option>
          <option v-for="cat in mergeTargets" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
        <div class="flex gap-3">
          <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="showMerge = false">{{ $t('common.cancel') }}</button>
          <button type="submit" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium">{{ $t('categories.merge') }}</button>
        </div>
      </form>
    </BaseModal>

    <!-- Modal -->
    <BaseModal v-model="showModal" width-class="max-w-lg" content-class="max-h-[90vh] overflow-y-auto">
        <h2 class="font-display text-xl font-semibold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form class="space-y-4" @submit.prevent="saveCategory">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.name') }}</label>
            <input v-model="form.name" required class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-danger-500' : 'text-slate-500'" @click="form.type = 'expense'">{{ $t('categories.types.expense') }}</button>
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500' : 'text-slate-500'" @click="form.type = 'income'">{{ $t('categories.types.income') }}</button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.icon') }}</label>
            <div class="grid grid-cols-7 gap-2 mb-2">
              <button
v-for="icon in presetIcons" :key="icon" type="button" class="aspect-square rounded-lg flex items-center justify-center transition-colors"
                :class="form.icon === icon ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 ring-2 ring-primary-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'"
                @click="selectIcon(icon)">
                <Icon :name="icon" set="category" class="w-5 h-5" />
              </button>
            </div>
            <div class="p-3 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" @click="triggerFileUpload">
              <span class="text-xs text-slate-500">{{ $t('categories.upload_svg') }}</span>
              <input ref="fileInput" type="file" accept=".svg" class="hidden" @change="handleFileUpload" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.color') }}</label>
            <div class="flex flex-wrap gap-2">
              <button
v-for="color in presetColors" :key="color" type="button" class="w-8 h-8 rounded-full transition-all"
                :class="form.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-slate-900' : ''"
                :style="{ backgroundColor: color, ringColor: color }"
                @click="form.color = color"></button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.parent') }}</label>
            <select v-model="form.parent_id" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
              <option :value="null">{{ $t('categories.no_parent') }}</option>
              <option v-for="cat in parentOptions" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closeModal">{{ $t('common.cancel') }}</button>
            <button type="submit" :disabled="saving" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium disabled:opacity-50">{{ $t('common.save') }}</button>
          </div>
        </form>
      </BaseModal>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useCategoriesStore } from '../stores/categories'
import { useAuthStore } from '../stores/auth'
import SafeSvg from '../components/SafeSvg.vue'
import { useI18n } from 'vue-i18n'
import { useHotkeys } from '@/composables/useHotkeys'
import { categoryIconImports } from '@/utils/icons'
import { presetColors } from '@/utils/colors'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'
import { api } from '@/utils/api'

const { t } = useI18n()
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveCategory() },
  'esc': () => { if (showModal.value) closeModal() }
})
const categoriesStore = useCategoriesStore()
const authStore = useAuthStore()

// Categories are shared by every user: only an admin may edit or merge them
const isAdmin = computed(() => authStore.user?.role === 'admin')

// Merge: move all transactions/rules/budgets into another category of the same type
const showMerge = ref(false)
const mergeSource = ref(null)
const mergeTargetId = ref(null)
const mergeTargets = computed(() =>
  mergeSource.value
    ? categoriesStore.categories.filter(c => c.type === mergeSource.value.type && c.id !== mergeSource.value.id)
    : []
)

function openMerge(cat) {
  if (!isAdmin.value) return
  mergeSource.value = cat
  mergeTargetId.value = null
  showMerge.value = true
}

async function confirmMerge() {
  if (!mergeSource.value || !mergeTargetId.value) return
  const confirmed = await window.$confirm({ message: t('categories.merge_confirm', { name: mergeSource.value.name }), danger: true })
  if (!confirmed) return
  try {
    await api(`/categories/${mergeSource.value.id}/merge`, { method: 'POST', body: JSON.stringify({ target_id: mergeTargetId.value }) })
    await categoriesStore.fetchCategories()
    window.$toast?.success(t('categories.merge_done'))
    showMerge.value = false
  } catch (e) {
    window.$toast?.error(e.message || t('common.error'))
  }
}
const showModal = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const fileInput = ref(null)
const form = reactive({ name: '', type: 'expense', color: '#f43f5e', icon: 'tag', icon_custom: null, parent_id: null })

const presetIcons = Object.keys(categoryIconImports).slice(0, 49)

onMounted(() => categoriesStore.fetchCategories())

const parentOptions = computed(() => {
  return categoriesStore.categories.filter(c => c.type === form.type && c.id !== form.id)
})

function filteredCategories(type) {
  return categoriesStore.categories.filter(c => c.type === type)
}

function parentName(parentId) {
  const parent = categoriesStore.categories.find(c => c.id === parentId)
  return parent ? parent.name : ''
}

function selectIcon(icon) {
  form.icon = icon
  form.icon_custom = null
}

function triggerFileUpload() {
  fileInput.value?.click()
}

function handleFileUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    form.icon_custom = ev.target.result
    form.icon = null
  }
  reader.readAsText(file)
}

function openModal() {
  isEditing.value = false
  Object.assign(form, { name: '', type: 'expense', color: '#f43f5e', icon: 'tag', icon_custom: null, parent_id: null })
  showModal.value = true
}

function editCategory(category) {
  if (!isAdmin.value) return
  isEditing.value = true
  Object.assign(form, category)
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

async function saveCategory() {
  if (saving.value) return
  const data = { name: form.name, type: form.type, color: form.color, icon: form.icon, icon_custom: form.icon_custom, parent_id: form.parent_id }
  saving.value = true
  try {
    if (isEditing.value) {
      await categoriesStore.updateCategory(form.id, data)
    } else {
      await categoriesStore.createCategory(data)
    }
    closeModal()
  } catch (e) {
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}
</script>
