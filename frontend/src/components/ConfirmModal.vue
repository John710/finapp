<template>
  <div v-if="visible" class="fixed inset-0 z-[70] flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="cancel"></div>
    <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6 relative z-10 shadow-xl border border-slate-200 dark:border-slate-800">
      <h3 class="text-lg font-bold mb-2">{{ title }}</h3>
      <p class="text-sm text-slate-500 mb-6">{{ message }}</p>
      <div class="flex gap-3">
        <button @click="cancel" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          {{ cancelText }}
        </button>
        <button @click="confirm" :class="danger ? 'bg-danger-500 hover:bg-danger-600' : 'bg-primary-600 hover:bg-primary-700'" class="flex-1 py-2.5 rounded-lg text-white text-sm font-medium transition-colors">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const visible = ref(false)
const title = ref('')
const message = ref('')
const confirmText = ref('OK')
const cancelText = ref('Cancel')
const danger = ref(false)
let resolvePromise = null

function open(opts = {}) {
  title.value = opts.title || 'Confirm'
  message.value = opts.message || ''
  confirmText.value = opts.confirmText || 'OK'
  cancelText.value = opts.cancelText || 'Cancel'
  danger.value = opts.danger || false
  visible.value = true
  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

function confirm() {
  visible.value = false
  if (resolvePromise) resolvePromise(true)
}

function cancel() {
  visible.value = false
  if (resolvePromise) resolvePromise(false)
}

defineExpose({ open })
</script>
