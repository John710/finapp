<template>
  <div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('nav.calendar') }}</h1>
      <router-link to="/recurring" class="self-start px-4 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2">
        <Icon name="repeat" class="w-4 h-4" />
        {{ $t('recurring.title') }}
      </router-link>
    </div>

    <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-4 lg:p-5">
      <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div class="flex items-center gap-2">
          <button class="w-9 h-9 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500" :aria-label="$t('recurring.calendar.prev_month')" @click="shiftMonth(-1)">
            <Icon name="arrowLeft" class="w-4 h-4" />
          </button>
          <p class="font-display text-lg font-semibold capitalize min-w-40">{{ monthLabel }}</p>
          <button class="w-9 h-9 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500" :aria-label="$t('recurring.calendar.next_month')" @click="shiftMonth(1)">
            <Icon name="arrowRight" class="w-4 h-4" />
          </button>
        </div>
        <button class="px-3 py-1.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-600 dark:text-slate-300" @click="goToday">{{ $t('recurring.calendar.today') }}</button>
      </div>

      <div class="grid grid-cols-7 gap-1 mb-1">
        <p v-for="label in weekdayLabels" :key="label" class="text-[11px] font-medium text-slate-400 text-center py-1">{{ label }}</p>
      </div>

      <div v-if="recurringStore.occurrencesLoading" class="grid grid-cols-7 gap-1">
        <BaseSkeleton v-for="i in 35" :key="i" height="5rem" />
      </div>

      <div v-else class="grid grid-cols-7 gap-1">
        <div v-for="cell in cells" :key="cell.date" class="rounded-xl p-1 min-h-20 lg:min-h-28 flex flex-col" :class="cellClass(cell)">
          <span class="text-[11px] font-medium self-end px-1" :class="cell.date === today ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400'">{{ cell.day }}</span>
          <div class="flex flex-col gap-1 mt-1">
            <button
v-for="occurrence in cell.visible" :key="occurrence.key" type="button"
              class="w-full text-left px-1.5 py-1 rounded-md text-[10px] lg:text-[11px] font-medium border-0 truncate transition-opacity hover:opacity-80"
              :class="chipClass(occurrence)" @click="openOccurrence(occurrence)">
              {{ occurrence.name }} · {{ chipAmount(occurrence) }}
            </button>
            <p v-if="cell.extra > 0" class="text-[10px] text-slate-400 px-1.5">+{{ cell.extra }}</p>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
        <span v-for="entry in legend" :key="entry.key" class="flex items-center gap-1.5 text-xs text-slate-500">
          <span class="w-2.5 h-2.5 rounded-full" :class="entry.dot"></span>{{ entry.label }}
        </span>
      </div>
    </div>

    <BaseModal v-model="selected.show" width-class="max-w-sm" z-class="z-50">
      <template v-if="selected.occurrence">
        <h2 class="font-display text-xl font-semibold mb-1">{{ $t('recurring.calendar.occurrence') }}</h2>
        <p class="text-sm text-slate-500 mb-4">{{ selected.occurrence.name }} • {{ formatDate(selected.occurrence.date) }}</p>
        <p class="text-2xl font-semibold mb-1" :class="selected.occurrence.type === 'income' ? 'text-primary-600' : 'text-danger-500'">
          {{ selected.occurrence.type === 'income' ? '+' : '−' }}{{ amountText(selected.occurrence) }}
        </p>
        <p class="text-xs text-slate-400 mb-5">{{ selected.occurrence.account_name }}<template v-if="selected.occurrence.category_name"> • {{ selected.occurrence.category_name }}</template></p>

        <div v-if="!selected.occurrence.paid && !selected.occurrence.skipped && canManage" class="flex gap-2">
          <button class="flex-1 py-2.5 rounded-full border-0 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium" :disabled="busy" @click="act('pay')">{{ $t('recurring.actions.pay') }}</button>
          <button class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium" :disabled="busy" @click="act('skip')">{{ $t('recurring.actions.skip') }}</button>
        </div>
        <div v-else-if="(selected.occurrence.paid || selected.occurrence.skipped) && canManage" class="flex gap-2">
          <button class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium" :disabled="busy" @click="act(selected.occurrence.paid ? 'unpay' : 'unskip')">
            {{ $t(selected.occurrence.paid ? 'recurring.actions.unpay' : 'recurring.actions.unskip') }}
          </button>
        </div>

        <button type="button" class="w-full mt-3 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="selected.show = false">{{ $t('common.close') }}</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRecurringStore } from '../stores/recurring'
import { useRatesStore } from '../stores/rates'
import { formatDate, formatCurrency, parseAmount } from '@/utils/format'
import { getUserLocale, getFirstDayOfWeek } from '@/utils/locale'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'

const ITEMS_PER_CELL = 3

const { t } = useI18n()
const recurringStore = useRecurringStore()
const ratesStore = useRatesStore()

function todayValue() {
  return new Date().toLocaleDateString('sv-SE')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

// Cells are addressed by their 'YYYY-MM-DD' key: parsing that string keeps the
// grid off the timezone-sensitive Date(year, month, day) arithmetic.
function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('sv-SE')
}

function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay()
}

const locale = computed(() => getUserLocale())
const firstDay = getFirstDayOfWeek()
const today = todayValue()
const busy = ref(false)
const selected = ref({ show: false, occurrence: null })
const cursor = ref({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })

const monthFirst = computed(() => `${pad(cursor.value.year)}-${pad(cursor.value.month)}-01`)
const firstOffset = computed(() => (weekdayOf(monthFirst.value) - firstDay + 7) % 7)
const gridStart = computed(() => addDays(monthFirst.value, -firstOffset.value))
const cellCount = computed(() => {
  const days = new Date(cursor.value.year, cursor.value.month, 0).getDate()
  return Math.ceil((firstOffset.value + days) / 7) * 7
})
const gridEnd = computed(() => addDays(gridStart.value, cellCount.value - 1))

const byDate = computed(() => {
  const map = new Map()
  for (const occurrence of recurringStore.occurrences) {
    if (!map.has(occurrence.date)) map.set(occurrence.date, [])
    map.get(occurrence.date).push({ ...occurrence, key: `${occurrence.rule_id}-${occurrence.date}` })
  }
  return map
})

const cells = computed(() => {
  const grouped = byDate.value
  const month = cursor.value.month
  return Array.from({ length: cellCount.value }, (_, index) => {
    const date = addDays(gridStart.value, index)
    const items = grouped.get(date) || []
    return {
      date,
      day: Number(date.slice(8, 10)),
      inMonth: Number(date.slice(5, 7)) === month,
      visible: items.slice(0, ITEMS_PER_CELL),
      extra: items.length - ITEMS_PER_CELL
    }
  })
})

const weekdayLabels = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  // 2024-01-07 is a Sunday, so 7 + weekday indexes the matching day name.
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 7 + (firstDay + index) % 7)))
})

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(new Date(cursor.value.year, cursor.value.month - 1, 1))
)

const legend = computed(() => [
  { key: 'upcoming', label: t('recurring.calendar.legend_upcoming'), dot: 'bg-primary-500' },
  { key: 'due', label: t('recurring.calendar.legend_due'), dot: 'bg-amber-500' },
  { key: 'overdue', label: t('recurring.calendar.legend_overdue'), dot: 'bg-danger-500' },
  { key: 'paid', label: t('recurring.calendar.legend_paid'), dot: 'bg-emerald-500' },
  { key: 'skipped', label: t('recurring.calendar.legend_skipped'), dot: 'bg-slate-400' }
])

const canManage = computed(() => {
  const occurrence = selected.value.occurrence
  if (!occurrence) return false
  return recurringStore.rules.find(rule => rule.id === occurrence.rule_id)?.is_owner !== false
})

onMounted(() => recurringStore.fetchRules())

watch(
  () => [gridStart.value, gridEnd.value],
  ([from, to]) => recurringStore.fetchOccurrences(from, to),
  { immediate: true }
)

function shiftMonth(delta) {
  const next = cursor.value.month + delta
  cursor.value = { year: cursor.value.year + Math.floor((next - 1) / 12), month: ((next - 1) % 12) + 1 }
}

function goToday() {
  cursor.value = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
}

function cellClass(cell) {
  return cell.inMonth ? 'bg-slate-100/70 dark:bg-slate-800/40' : 'bg-slate-50 dark:bg-slate-900/40'
}

function chipClass(occurrence) {
  if (occurrence.paid) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (occurrence.skipped) return 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 line-through'
  if (occurrence.date < today) return 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300'
  if (occurrence.date === today) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  return 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
}

function chipAmount(occurrence) {
  const sign = occurrence.type === 'income' ? '+' : '−'
  return `${sign}${formatCurrency(parseAmount(occurrence.amount), occurrence.currency)}`
}

function amountText(occurrence) {
  return ratesStore.formatConverted(occurrence.amount, occurrence.currency || ratesStore.baseCurrency)
}

function openOccurrence(occurrence) {
  selected.value = { show: true, occurrence }
}

async function act(kind) {
  const occurrence = selected.value.occurrence
  if (!occurrence || busy.value) return
  busy.value = true
  const target = { ruleId: occurrence.rule_id, date: occurrence.date }
  const toastKey = {
    pay: 'recurring.paid_toast',
    skip: 'recurring.skipped_toast',
    unpay: 'recurring.unpaid_toast',
    unskip: 'recurring.unskipped_toast'
  }[kind]
  try {
    if (kind === 'pay') await recurringStore.payOccurrence(target)
    if (kind === 'skip') await recurringStore.skipOccurrence(target)
    if (kind === 'unpay') await recurringStore.unpayOccurrence(target)
    if (kind === 'unskip') await recurringStore.unskipOccurrence(target)
    window.$toast?.success(t(toastKey, { date: formatDate(occurrence.date) }))
    selected.value.show = false
  } catch (err) {
    window.$toast?.error(err.message)
  } finally {
    busy.value = false
  }
}
</script>
