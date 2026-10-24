<template>
  <div
    class="animate-pulse rounded-2xl bg-slate-200/80 dark:bg-slate-700/60"
    :style="{ height, width }"
    aria-hidden="true"
  ></div>
</template>

<script setup>
defineProps({
  height: { type: String, default: '1rem' },
  width: { type: String, default: '100%' }
})
</script>
