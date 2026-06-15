<template>
  <div
    v-if="modelValue"
    ref="modalRef"
    class="fixed inset-0 flex p-4"
    :class="[zClass, alignClass]"
    role="dialog"
    aria-modal="true"
    :aria-label="ariaLabel"
    :aria-labelledby="ariaLabelledBy"
    @click.self="close"
    @keydown.esc="close"
    tabindex="-1"
  >
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click.self="close"></div>
    <div
      class="bg-white dark:bg-slate-900 w-full rounded-2xl p-6 relative z-10 shadow-2xl border border-slate-200 dark:border-slate-700"
      :class="[widthClass, contentClass]"
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  widthClass: { type: String, default: 'max-w-sm' },
  zClass: { type: String, default: 'z-50' },
  alignClass: { type: String, default: 'items-center justify-center' },
  contentClass: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  ariaLabelledBy: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const modalRef = ref(null)
useFocusTrap(modalRef, () => props.modelValue)

function close() {
  emit('update:modelValue', false)
}
</script>
