<template>
  <HugeiconsIcon
    v-if="loadedIcon"
    :icon="loadedIcon"
    :size="size"
    :color="color"
    :stroke-width="strokeWidth"
    aria-hidden="true"
  />
</template>

<script setup>
import { shallowRef, watch } from 'vue'
import { HugeiconsIcon } from '@hugeicons/vue'
import { uiIconImports, categoryIconImports } from '@/utils/icons'
import { logger } from '@/utils/logger.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  color: { type: String, default: 'currentColor' },
  strokeWidth: { type: Number, default: 1.5 },
  set: { type: String, default: 'ui' } // 'ui' or 'category'
})

const loadedIcon = shallowRef(null)

async function loadIcon() {
  const map = props.set === 'category' ? categoryIconImports : uiIconImports
  const loader = map[props.name]
  if (!loader) {
    loadedIcon.value = null
    return
  }
  try {
    const mod = await loader()
    loadedIcon.value = mod.default || mod
  } catch (e) {
    logger.warn(`Failed to load icon "${props.name}":`, e)
    loadedIcon.value = null
  }
}

loadIcon()
watch(() => [props.name, props.set], loadIcon)
</script>
