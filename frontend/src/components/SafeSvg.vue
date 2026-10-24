<template>
  <span v-html="safeSvg"></span>
</template>

<script setup>
import { computed } from 'vue'
import { sanitizeSvg } from '../utils/sanitizeSvg.js'

const props = defineProps({
  svg: {
    type: String,
    default: ''
  }
})

const safeSvg = computed(() => sanitizeSvg(props.svg))
</script>
