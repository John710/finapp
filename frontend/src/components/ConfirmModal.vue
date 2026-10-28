<template>
  <div v-if="visible" class="fixed inset-0 z-[70] flex items-center justify-center p-4" @keydown="onKeydown">
    <div class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" @click="cancel"></div>
    <div
      ref="modalRef"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-6 relative z-10 shadow-float border-0 outline-none"
      tabindex="-1"
    >
      <h3 :id="titleId" class="font-display text-lg font-semibold mb-2">{{ title }}</h3>
      <p class="text-sm text-slate-500 mb-6">{{ message }}</p>
      <div class="flex gap-3">
        <button ref="cancelBtn" class="flex-1 py-2.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" @click="cancel">
          {{ cancelText }}
        </button>
        <button ref="confirmBtn" :class="danger ? 'bg-danger-500 hover:bg-danger-600' : 'bg-primary-500 hover:bg-primary-600 shadow-card'" class="flex-1 py-2.5 rounded-full text-white text-sm font-semibold transition-colors" @click="confirm">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const visible = ref(false)
const title = ref('')
const message = ref('')
const confirmText = ref('')
const cancelText = ref('')
const danger = ref(false)
let resolvePromise = null

const titleId = 'confirm-modal-title'
const modalRef = ref(null)
const confirmBtn = ref(null)
const cancelBtn = ref(null)

function open(opts = {}) {
  // A previous confirm that is still pending is superseded: settle it as cancelled
  if (resolvePromise) resolvePromise(false)
  title.value = opts.title || t('common.confirm_title')
  message.value = opts.message || ''
  confirmText.value = opts.confirmText || t('common.confirm')
  cancelText.value = opts.cancelText || t('common.cancel')
  danger.value = opts.danger || false
  visible.value = true
  nextTick(() => {
    cancelBtn.value?.focus()
  })
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

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
    return
  }
  if (e.key === 'Tab') {
    const focusables = [
      cancelBtn.value,
      confirmBtn.value
    ].filter(Boolean)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

defineExpose({ open })
</script>
