<template>
  <router-view />
  <ToastContainer />
</template>

<script setup>
import { watch } from 'vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { useToast } from '@/composables/useToast.js'
import i18n from '@/i18n'

// Toasts must work everywhere — including /login and /register, which render
// outside LayoutView (where window.$toast used to be initialized).
const toast = useToast()
if (typeof window !== 'undefined') {
  window.$toast = toast
}

// Keep <html lang> in sync with the UI language (a11y, hyphenation, translate hints)
watch(() => i18n.global.locale.value, (locale) => {
  document.documentElement.lang = locale
}, { immediate: true })
</script>
