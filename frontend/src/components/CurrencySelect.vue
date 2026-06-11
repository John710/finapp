<template>
  <div class="relative" ref="selectRef">
    <button type="button" @click="toggle" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left text-sm flex items-center justify-between">
      <span v-if="modelValue">{{ selectedLabel }}</span>
      <span v-else class="text-slate-400">{{ placeholder }}</span>
      <Icon name="arrowDown" class="w-4 h-4 text-slate-400" />
    </button>
    <div v-if="showDropdown" class="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg max-h-60 overflow-hidden flex flex-col">
      <div class="p-2 border-b border-slate-100 dark:border-slate-800">
        <input v-model="search" type="text" :placeholder="searchPlaceholder" ref="searchInput" class="w-full px-2 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" @keydown="onKeydown" />
      </div>
      <div class="overflow-y-auto flex-1">
        <button v-for="fc in filteredCurrencies" :key="fc.code" type="button" @click="select(fc)"
          class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between transition-colors"
          :class="modelValue === fc.code ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600' : ''">
          <span class="font-medium">{{ fc.code }}</span>
          <span class="text-slate-500 text-xs">{{ fc.name }}</span>
        </button>
        <div v-if="filteredCurrencies.length === 0" class="px-3 py-4 text-sm text-slate-500 text-center">{{ emptyText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRatesStore } from '../stores/rates'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Select currency...' },
  searchPlaceholder: { type: String, default: 'Search' },
  emptyText: { type: String, default: 'Not found' }
})

const emit = defineEmits(['update:modelValue'])

const ratesStore = useRatesStore()
const showDropdown = ref(false)
const search = ref('')
const selectRef = ref(null)
const searchInput = ref(null)

const selectedLabel = computed(() => {
  const fc = ratesStore.fiatCurrencies.find(c => c.code === props.modelValue)
  return fc ? `${fc.code} — ${fc.name}` : props.modelValue
})

const filteredCurrencies = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return ratesStore.fiatCurrencies
  return ratesStore.fiatCurrencies.filter(fc =>
    fc.code.toLowerCase().includes(q) ||
    fc.name.toLowerCase().includes(q) ||
    (fc.symbol && fc.symbol.toLowerCase().includes(q))
  )
})

function toggle() {
  showDropdown.value = !showDropdown.value
}

function select(fc) {
  emit('update:modelValue', fc.code)
  showDropdown.value = false
  search.value = ''
}

function onKeydown(e) {
  if (e.key === 'Escape') showDropdown.value = false
}

watch(showDropdown, async (val) => {
  if (val) {
    search.value = ''
    await nextTick()
    searchInput.value?.focus()
  }
})

function onDocClick(e) {
  if (showDropdown.value && selectRef.value && !selectRef.value.contains(e.target)) {
    showDropdown.value = false
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', onDocClick)
}
</script>
