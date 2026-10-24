<template>
  <router-view />
  <ToastContainer />
</template>

<script setup>
import ToastContainer from '@/components/ToastContainer.vue'
import { useToast } from '@/composables/useToast.js'

// Toasts must work everywhere — including /login and /register, which render
// outside LayoutView (where window.$toast used to be initialized).
const toast = useToast()
if (typeof window !== 'undefined') {
  window.$toast = toast
}
</script>
