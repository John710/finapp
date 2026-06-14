<template>
  <span
    class="text-xs px-2 py-0.5 rounded-full"
    :class="dirty
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'"
  >
    {{ dirty ? $t('settings.status_unsaved') : $t('settings.status_saved') }}
  </span>
</template>

<script setup>
defineProps({
  dirty: {
    type: Boolean,
    default: false
  }
})
</script>
