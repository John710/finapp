<template>
  <div class="fixed bottom-4 right-4 z-[70] space-y-2">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id"
        class="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium max-w-sm"
        :class="typeClass(toast.type)">
        <Icon v-if="toast.type === 'success'" name="check" class="w-5 h-5 shrink-0" />
        <Icon v-else-if="toast.type === 'error'" name="cancel" class="w-5 h-5 shrink-0" />
        <Icon v-else-if="toast.type === 'warning'" name="alert" class="w-5 h-5 shrink-0" />
        <Icon v-else name="info" class="w-5 h-5 shrink-0" />
        <span>{{ toast.message }}</span>
        <button @click="remove(toast.id)" class="ml-auto text-current opacity-60 hover:opacity-100">
          <Icon name="cancel" class="w-4 h-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useToast } from '@/composables/useToast'

const { toasts } = useToast()

function remove(id) {
  const idx = toasts.findIndex(t => t.id === id)
  if (idx !== -1) toasts.splice(idx, 1)
}

function typeClass(type) {
  switch (type) {
    case 'success': return 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-200'
    case 'error': return 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-200'
    case 'warning': return 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200'
    default: return 'bg-slate-50 border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200'
  }
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
