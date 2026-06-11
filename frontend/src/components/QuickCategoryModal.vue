<template>
  <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close"></div>
    <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6 relative z-10">
      <h2 class="text-xl font-bold mb-4">{{ $t('common.add') }} {{ $t('categories.title').toLowerCase() }}</h2>
      <form @submit.prevent="save" class="space-y-4">
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
          <label class="block text-sm font-medium mb-1">{{ $t('categories.color') }}</label>
          <div class="flex flex-wrap gap-2">
            <button v-for="color in presetColors" :key="color" type="button" @click="form.color = color"
              class="w-8 h-8 rounded-full transition-all"
              :class="form.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-slate-900' : ''"
              :style="{ backgroundColor: color, ringColor: color }"></button>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('categories.icon') }}</label>
          <div class="grid grid-cols-7 gap-2">
            <button v-for="icon in presetIcons" :key="icon" type="button" @click="form.icon = icon"
              class="aspect-square rounded-lg flex items-center justify-center transition-colors"
              :class="form.icon === icon ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 ring-2 ring-primary-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'">
              <Icon :name="icon" set="category" class="w-5 h-5" />
            </button>
          </div>
        </div>
        <div class="flex gap-3 mt-6">
          <button type="button" @click="close" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
          <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, watch } from 'vue'
import { useCategoriesStore } from '../stores/categories'
import { categoryIcons } from '@/utils/icons'

const props = defineProps({ modelValue: Boolean, defaultType: { type: String, default: 'expense' } })
const emit = defineEmits(['update:modelValue', 'created'])

const categoriesStore = useCategoriesStore()
const presetColors = ['#f43f5e', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#f472b6', '#94a3b8']
const presetIcons = Object.keys(categoryIcons).slice(0, 49)
const form = reactive({ name: '', type: props.defaultType, color: '#f43f5e', icon: 'tag' })

watch(() => props.modelValue, (val) => {
  if (val) Object.assign(form, { name: '', type: props.defaultType, color: '#f43f5e', icon: 'tag' })
})

function close() {
  emit('update:modelValue', false)
}

async function save() {
  const category = await categoriesStore.createCategory({ ...form, icon_custom: null, parent_id: null })
  emit('created', category)
  close()
}
</script>
