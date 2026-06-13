<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ $t('categories.title') }}</h1>
      <button @click="openModal()" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="categoriesStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="categoriesStore.categories.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('categories.empty') }}</p>
    </div>

    <div v-else>
      <div v-for="type in ['income', 'expense']" :key="type" class="mb-8">
        <h3 class="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{{ $t('categories.types.' + type) }}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div v-for="cat in filteredCategories(type)" :key="cat.id"
            class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer"
            @click="editCategory(cat)">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: cat.color + '20', color: cat.color }">
              <span v-if="cat.icon_custom" v-html="sanitizeSvg(cat.icon_custom)"></span>
              <Icon v-else-if="cat.icon" :name="cat.icon" set="category" class="w-5 h-5" />
              <Icon v-else name="tag" class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <span class="font-medium truncate block">{{ cat.name }}</span>
              <span v-if="cat.parent_id" class="text-xs text-slate-500">{{ parentName(cat.parent_id) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl p-6 relative z-10 max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form @submit.prevent="saveCategory" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.name') }}</label>
            <input v-model="form.name" required class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" @click="form.type = 'expense'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-danger-500' : 'text-slate-500'">{{ $t('categories.types.expense') }}</button>
              <button type="button" @click="form.type = 'income'" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500' : 'text-slate-500'">{{ $t('categories.types.income') }}</button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.icon') }}</label>
            <div class="grid grid-cols-7 gap-2 mb-2">
              <button v-for="icon in presetIcons" :key="icon" type="button" @click="selectIcon(icon)"
                class="aspect-square rounded-lg flex items-center justify-center transition-colors"
                :class="form.icon === icon ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 ring-2 ring-primary-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'">
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
              <button v-for="color in presetColors" :key="color" type="button" @click="form.color = color"
                class="w-8 h-8 rounded-full transition-all"
                :class="form.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-slate-900' : ''"
                :style="{ backgroundColor: color, ringColor: color }"></button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('categories.parent') }}</label>
            <select v-model="form.parent_id" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
              <option :value="null">{{ $t('categories.no_parent') }}</option>
              <option v-for="cat in parentOptions" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closeModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { useCategoriesStore } from '../stores/categories'
import { sanitizeSvg } from '../utils/sanitizeSvg.js'
import { useI18n } from 'vue-i18n'
import { useHotkeys } from '@/composables/useHotkeys'
import { categoryIcons } from '@/utils/icons'

const { t } = useI18n()
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveCategory() },
  'esc': () => { if (showModal.value) closeModal() }
})
const categoriesStore = useCategoriesStore()
const showModal = ref(false)
const isEditing = ref(false)
const fileInput = ref(null)
const form = reactive({ name: '', type: 'expense', color: '#f43f5e', icon: 'tag', icon_custom: null, parent_id: null })

const presetColors = ['#f43f5e', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#f472b6', '#94a3b8']
const presetIcons = Object.keys(categoryIcons).slice(0, 49)

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
  isEditing.value = true
  Object.assign(form, category)
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

async function saveCategory() {
  const data = { name: form.name, type: form.type, color: form.color, icon: form.icon, icon_custom: form.icon_custom, parent_id: form.parent_id }
  if (isEditing.value) {
    await categoriesStore.updateCategory(form.id, data)
  } else {
    await categoriesStore.createCategory(data)
  }
  closeModal()
}
</script>
