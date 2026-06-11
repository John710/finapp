<template>
  <HugeiconsIcon
    v-if="iconData"
    :icon="iconData"
    :size="size"
    :color="color"
    :stroke-width="strokeWidth"
  />
</template>

<script setup>
import { computed } from 'vue'
import { HugeiconsIcon } from '@hugeicons/vue'
import { uiIcons, categoryIcons } from '@/utils/icons'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  color: { type: String, default: 'currentColor' },
  strokeWidth: { type: Number, default: 1.5 },
  set: { type: String, default: 'ui' } // 'ui' or 'category'
})

const iconData = computed(() => {
  const map = props.set === 'category' ? categoryIcons : uiIcons
  return map[props.name] || null
})
</script>
