<template>
  <BaseModal :modelValue="modelValue" @update:modelValue="$emit('update:modelValue', $event)" widthClass="max-w-sm" zClass="z-50">
    <h2 class="font-display text-xl font-semibold mb-4">{{ $t('common.add') }} {{ $t('accounts.title').toLowerCase() }}</h2>
    <form @submit.prevent="save" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1">{{ $t('common.name') }}</label>
        <input v-model="form.name" required class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 focus:outline-none focus:ring-2 focus:ring-primary-400" />
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
          <select v-model="form.type" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
            <option value="card">{{ $t('accounts.types.card') }}</option>
            <option value="cash">{{ $t('accounts.types.cash') }}</option>
            <option value="crypto">{{ $t('accounts.types.crypto') }}</option>
            <option value="other">{{ $t('accounts.types.other') }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
          <input v-model="form.currency" maxlength="3" required class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 uppercase" />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">{{ $t('accounts.initial_balance') }}</label>
        <input v-model.number="form.balance" type="number" step="0.01" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">{{ $t('accounts.color') }}</label>
        <div class="flex flex-wrap gap-2">
          <button v-for="color in presetColors" :key="color" type="button" @click="form.color = color"
            class="w-8 h-8 rounded-full transition-all"
            :class="form.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-slate-900' : ''"
            :style="{ backgroundColor: color, ringColor: color }"></button>
        </div>
      </div>
      <div class="flex gap-3 mt-6">
        <button type="button" @click="close" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
        <button type="submit" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium">{{ $t('common.save') }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup>
import { reactive, watch, computed } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { useRatesStore } from '../stores/rates'
import { presetColors } from '@/utils/colors'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'created'])

const accountsStore = useAccountsStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const form = reactive({ name: '', type: 'card', currency: baseCurrency.value, balance: 0, color: '#10b981' })

watch(() => props.modelValue, (val) => {
  if (val) Object.assign(form, { name: '', type: 'card', currency: baseCurrency.value, balance: 0, color: '#10b981' })
})

function close() {
  emit('update:modelValue', false)
}

async function save() {
  const account = await accountsStore.createAccount({ ...form })
  emit('created', account)
  close()
}
</script>
