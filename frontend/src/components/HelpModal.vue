<template>
  <div v-if="modelValue" class="fixed inset-0 z-[60] flex items-center justify-center p-4" @click.self="close">
    <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="close"></div>
    <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 relative z-10 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">{{ $t('help.title') }}</h2>
        <button @click="close" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <Icon name="cancel" class="w-5 h-5" />
        </button>
      </div>
      <div class="space-y-3">
        <div v-for="group in shortcuts" :key="group.title">
          <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{{ group.title }}</h3>
          <div class="space-y-1.5">
            <div v-for="s in group.items" :key="s.keys" class="flex items-center justify-between py-1.5">
              <span class="text-sm">{{ s.desc }}</span>
              <kbd class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-600 dark:text-slate-400">{{ s.keys }}</kbd>
            </div>
          </div>
        </div>
      </div>
      <div class="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-center">
        <button @click="close" class="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700">{{ $t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const shortcuts = computed(() => [
  {
    title: t('help.navigation'),
    items: [
      { keys: 'Ctrl + Shift + K', desc: t('help.cmd_palette') },
      { keys: 'Shift + /', desc: t('help.show_help') },
      { keys: 'Esc', desc: t('help.close_modal') }
    ]
  },
  {
    title: t('help.actions'),
    items: [
      { keys: 'Ctrl + Enter', desc: t('help.save_form') },
      { keys: 'Ctrl + Shift + N', desc: t('help.new_transaction') }
    ]
  }
])

function close() {
  emit('update:modelValue', false)
}
</script>
