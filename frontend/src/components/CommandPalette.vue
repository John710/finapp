<template>
  <BaseModal
    :model-value="modelValue"
    width-class="max-w-lg p-0 rounded-3xl overflow-hidden"
    z-class="z-[60]"
    align-class="items-start justify-center pt-[20vh]"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
      <Icon name="search" class="w-5 h-5 text-slate-400" />
      <input
        ref="inputRef"
        v-model="query"
        :placeholder="$t('command_palette.placeholder')"
        class="flex-1 bg-transparent outline-none text-sm"
        role="combobox"
        aria-expanded="true"
        aria-controls="command-listbox"
        :aria-activedescendant="selectedId"
        @keydown="onKeydown"
      />
      <kbd class="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 font-mono">ESC</kbd>
    </div>
    <div id="command-listbox" class="max-h-[60vh] overflow-y-auto py-2" role="listbox">
      <div v-if="filtered.length === 0" class="px-4 py-8 text-center text-sm text-slate-500">{{ $t('common.empty') }}</div>
      <button
        v-for="(item, i) in filtered"
        :id="`command-option-${i}`"
        :key="item.path"
        role="option"
        :aria-selected="i === selectedIndex"
        class="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors"
        :class="i === selectedIndex ? 'bg-primary-100 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300' : 'hover:bg-slate-50 dark:hover:bg-slate-800'"
        @click="select(item)"
      >
        <Icon :name="item.icon" class="w-4 h-4 text-slate-400" />
        <span class="text-sm">{{ item.name }}</span>
        <span v-if="item.shortcut" class="ml-auto text-[10px] text-slate-400 font-mono">{{ item.shortcut }}</span>
      </button>
    </div>
  </BaseModal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const router = useRouter()
const { t } = useI18n()
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref(null)
const selectedId = computed(() => filtered.value.length ? `command-option-${selectedIndex.value}` : undefined)

const items = computed(() => [
  { name: t('nav.dashboard'), path: '/', icon: 'home' },
  { name: t('nav.transactions'), path: '/transactions', icon: 'calculator' },
  { name: t('nav.accounts'), path: '/accounts', icon: 'creditCard' },
  { name: t('nav.categories'), path: '/categories', icon: 'tag' },
  { name: t('nav.budgets'), path: '/budgets', icon: 'wallet' },
  { name: t('nav.debts'), path: '/debts', icon: 'bank' },
  { name: t('nav.reports'), path: '/reports', icon: 'chart' },
  { name: t('nav.tags'), path: '/tags', icon: 'tag' },
  { name: t('nav.recurring'), path: '/recurring', icon: 'repeat' },
  { name: t('nav.calendar'), path: '/recurring/calendar', icon: 'calendar' },
  { name: t('nav.settings'), path: '/settings', icon: 'settings' },
  { name: `${t('transactions.add')} (${t('command_palette.new_transaction')})`, path: '/transactions', icon: 'plus', shortcut: 'Ctrl+Shift+N' }
])

const filtered = computed(() => {
  const q = query.value.toLowerCase()
  if (!q) return items.value
  return items.value.filter(i => i.name.toLowerCase().includes(q))
})

watch(() => props.modelValue, async (val) => {
  if (val) {
    query.value = ''
    selectedIndex.value = 0
    await nextTick()
    inputRef.value?.focus()
  }
})

watch(filtered, () => {
  selectedIndex.value = 0
})

function onKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = filtered.value[selectedIndex.value]
    if (item) select(item)
  } else if (e.key === 'Escape') {
    close()
  }
}

function select(item) {
  close()
  if (item.path === '/transactions' && item.shortcut) {
    router.push('/transactions')
    // Emit event for parent to open transaction modal
    setTimeout(() => window.dispatchEvent(new CustomEvent('open-transaction-modal')), 100)
  } else {
    router.push(item.path)
  }
}

function close() {
  emit('update:modelValue', false)
}
</script>
