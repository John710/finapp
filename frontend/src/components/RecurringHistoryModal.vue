<template>
  <BaseModal :model-value="modelValue" width-class="max-w-md" z-class="z-50" @update:model-value="$emit('update:modelValue', $event)">
    <h2 class="font-display text-xl font-semibold mb-1">{{ $t('recurring.history.title') }}</h2>
    <p v-if="rule" class="text-sm text-slate-500 mb-4">{{ rule.note || $t('recurring.title') }}</p>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="flex gap-3">
        <BaseSkeleton height="0.9rem" width="6rem" />
        <BaseSkeleton height="0.9rem" width="100%" />
      </div>
    </div>

    <div v-else-if="events.length === 0" class="text-sm text-slate-500 py-6 text-center">
      {{ $t('recurring.history.empty') }}
    </div>

    <ol v-else class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <li v-for="event in events" :key="event.id" class="flex gap-3 text-sm">
        <span class="mt-1.5 w-2 h-2 rounded-full shrink-0" :class="dotClass(event.event_type)"></span>
        <div class="min-w-0">
          <p class="font-medium">{{ $t('recurring.history.' + event.event_type) }}</p>
          <p v-if="detail(event)" class="text-slate-500 break-words">{{ detail(event) }}</p>
          <p class="text-xs text-slate-400">
            {{ formatDate(event.created_at) }}
            <template v-if="event.actor_login"> • {{ $t('recurring.history.by', { login: event.actor_login }) }}</template>
          </p>
        </div>
      </li>
    </ol>

    <div class="flex gap-3 mt-6">
      <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="close">{{ $t('common.close') }}</button>
    </div>
  </BaseModal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRecurringStore } from '../stores/recurring'
import { useRatesStore } from '../stores/rates'
import { formatDate } from '@/utils/format'
import { scheduleLabel } from '@/utils/recurring'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'

const props = defineProps({ modelValue: Boolean, rule: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()
const recurringStore = useRecurringStore()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const events = ref([])
const loading = ref(false)

watch(() => props.modelValue, async (open) => {
  if (!open || !props.rule) return
  loading.value = true
  try {
    events.value = await recurringStore.fetchHistory(props.rule.id)
  } finally {
    loading.value = false
  }
})

function close() {
  emit('update:modelValue', false)
}

function dotClass(type) {
  if (type === 'paid') return 'bg-emerald-500'
  if (type === 'skipped' || type === 'ended') return 'bg-slate-400'
  if (type === 'paused') return 'bg-amber-500'
  return 'bg-primary-500'
}

function money(value) {
  if (!value) return null
  const amount = typeof value === 'object' ? value.amount : value
  const currency = typeof value === 'object' ? value.currency : null
  if (amount === null || amount === undefined) return null
  return ratesStore.formatConverted(amount, currency || baseCurrency.value)
}

function detail(event) {
  const before = event.old_value || {}
  const after = event.new_value || {}
  switch (event.event_type) {
    case 'created':
      return t('recurring.history.created_detail', { amount: money(after), schedule: scheduleLabel(t, after) })
    case 'price_changed':
      return `${money(before)} → ${money(after)}`
    case 'currency_changed':
      return `${before.currency || '?'} → ${after.currency || '?'}`
    case 'schedule_changed':
      return t('recurring.history.schedule_changed_detail', { schedule: scheduleLabel(t, after) })
    case 'paid':
      return t('recurring.history.paid_detail', { date: formatDate(after.date || event.effective_date), amount: money(after) })
    case 'skipped':
      return t('recurring.history.skipped_detail', { date: formatDate(after.date || event.effective_date) })
    case 'ended':
      return after.last_date ? t('recurring.history.ended_detail', { date: formatDate(after.last_date) }) : null
    default:
      return null
  }
}
</script>
