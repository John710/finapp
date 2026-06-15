<template>
  <span v-html="safeSvg"></span>
</template>

<script setup>
import { computed } from 'vue'
import DOMPurify from 'dompurify'

const props = defineProps({
  svg: {
    type: String,
    default: ''
  }
})

const safeSvg = computed(() => {
  if (!props.svg) return ''
  return DOMPurify.sanitize(props.svg, { USE_PROFILES: { svg: true, svgFilters: true } })
})
</script>
