import Decimal from 'decimal.js'

const DAY_MS = 86400000
const AVG_DAYS_PER_MONTH = '30.4375'
const AVG_DAYS_PER_YEAR = '365.25'

const LEGACY_FREQUENCIES = {
  daily: { unit: 'day', value: 1 },
  weekly: { unit: 'week', value: 1 },
  biweekly: { unit: 'week', value: 2 },
  monthly: { unit: 'month', value: 1 },
  yearly: { unit: 'year', value: 1 }
}

const UNIT_FACTORS = {
  day: '1',
  week: '7',
  month: AVG_DAYS_PER_MONTH,
  year: AVG_DAYS_PER_YEAR
}

const MAX_SCAN = 2000

function isDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function parts(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day }
}

function format(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dayNum(dateStr) {
  const { year, month, day } = parts(dateStr)
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

function shiftDays(dateStr, days) {
  const date = new Date(dayNum(dateStr) * DAY_MS + days * DAY_MS)
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function monthIndex(dateStr) {
  const { year, month } = parts(dateStr)
  return year * 12 + (month - 1)
}

// The anchor day is kept unless the target month is shorter, so Jan 31 + 1 month
// is Feb 28 but Jan 31 + 2 months is still Mar 31 — no ratchet, unlike `date + INTERVAL`.
function monthDay(monthIdx, anchorDay) {
  const year = Math.floor(monthIdx / 12)
  const month = (monthIdx % 12) + 1
  return format(year, month, Math.min(anchorDay, daysInMonth(year, month)))
}

function earliest(...dates) {
  const valid = dates.filter(isDateStr)
  return valid.length ? valid.sort()[0] : null
}

function firstDate(...dates) {
  return dates.find(isDateStr) ?? null
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

function scheduleOf(rawRule) {
  const legacy = LEGACY_FREQUENCIES[rawRule?.frequency]
  const unit = UNIT_FACTORS[rawRule?.interval_unit] ? rawRule.interval_unit : (legacy?.unit ?? 'month')
  const value = positiveInt(rawRule?.interval_value) ?? legacy?.value ?? 1
  const startDate = firstDate(rawRule?.start_date, rawRule?.next_date)
  const anchorDay =
    Number.isInteger(rawRule?.billing_anchor_day) && rawRule.billing_anchor_day >= 1 && rawRule.billing_anchor_day <= 31
      ? rawRule.billing_anchor_day
      : startDate
        ? parts(startDate).day
        : 1
  return {
    unit,
    value,
    startDate,
    anchorDay,
    limit: positiveInt(rawRule?.payment_limit),
    autoRenew: rawRule?.auto_renew !== false,
    endDate: earliest(rawRule?.end_date, rawRule?.cancellation_date)
  }
}

function dateAtIndex(s, index) {
  if (!s.startDate || index < 0) return null
  const step = index * s.value
  if (s.unit === 'day') return shiftDays(s.startDate, step)
  if (s.unit === 'week') return shiftDays(s.startDate, step * 7)
  if (s.unit === 'year') return monthDay(monthIndex(s.startDate) + step * 12, s.anchorDay)
  return monthDay(monthIndex(s.startDate) + step, s.anchorDay)
}

function occurrenceAtIndex(s, index) {
  if (!s.autoRenew && index > 0) return null
  if (s.limit !== null && index >= s.limit) return null
  const date = dateAtIndex(s, index)
  if (!date) return null
  if (s.endDate && date > s.endDate) return null
  return date
}

// First index whose scheduled date is >= the given date. The estimate is exact for
// day/week and off by at most one for clamped month/year anchors, so both directions probe.
function firstIndexAtOrAfter(s, dateStr) {
  let index
  if (s.unit === 'day' || s.unit === 'week') {
    const stepDays = s.value * (s.unit === 'week' ? 7 : 1)
    index = Math.max(0, Math.ceil((dayNum(dateStr) - dayNum(s.startDate)) / stepDays))
  } else {
    const stepMonths = s.unit === 'year' ? s.value * 12 : s.value
    index = Math.max(0, Math.ceil((monthIndex(dateStr) - monthIndex(s.startDate)) / stepMonths))
  }
  while (index > 0 && dateAtIndex(s, index - 1) >= dateStr) index--
  while (dateAtIndex(s, index) !== null && dateAtIndex(s, index) < dateStr) index++
  return index
}

export function nthOccurrence(rawRule, index) {
  const s = scheduleOf(rawRule)
  if (!Number.isInteger(index) || index < 0) return null
  return occurrenceAtIndex(s, index)
}

export function occurrenceDates(rawRule, from, to) {
  const s = scheduleOf(rawRule)
  if (!s.startDate || !isDateStr(from) || !isDateStr(to) || from > to) return []
  const dates = []
  let index = firstIndexAtOrAfter(s, from)
  for (let guard = 0; guard < MAX_SCAN; guard++, index++) {
    const date = occurrenceAtIndex(s, index)
    if (!date || date > to) break
    if (date >= from) dates.push(date)
  }
  return dates
}

export function nextOccurrenceAfter(rawRule, dateStr) {
  const s = scheduleOf(rawRule)
  if (!s.startDate || !isDateStr(dateStr)) return null
  let index = firstIndexAtOrAfter(s, shiftDays(dateStr, 1))
  for (let guard = 0; guard < MAX_SCAN; guard++, index++) {
    const date = occurrenceAtIndex(s, index)
    if (!date) return null
    if (date > dateStr) return date
  }
  return null
}

export function occurrenceAllowed(rawRule, dateStr) {
  const s = scheduleOf(rawRule)
  if (!s.startDate || !isDateStr(dateStr)) return false
  return occurrenceAtIndex(s, firstIndexAtOrAfter(s, dateStr)) === dateStr
}

export function dueOccurrence(rawRule, todayStr, paidSet = new Set(), skipSet = new Set()) {
  const s = scheduleOf(rawRule)
  let cursor = isDateStr(rawRule?.next_date) ? rawRule.next_date : occurrenceAtIndex(s, 0)
  if (!cursor) return null
  for (let guard = 0; guard < MAX_SCAN; guard++) {
    if (!paidSet.has(cursor) && !skipSet.has(cursor)) return cursor
    cursor = nextOccurrenceAfter(rawRule, cursor)
    if (!cursor) return null
  }
  return cursor
}

export function statusOf(rawRule, todayStr, paidSet = new Set(), skipSet = new Set()) {
  if (rawRule?.is_active === false) return 'paused'
  const s = scheduleOf(rawRule)
  if (s.endDate && isDateStr(todayStr) && todayStr > s.endDate) return 'finished'
  const cursor = dueOccurrence(rawRule, todayStr, paidSet, skipSet)
  if (!cursor) return 'finished'
  if (!isDateStr(todayStr)) return 'scheduled'
  if (cursor < todayStr) return 'overdue'
  if (cursor === todayStr) return 'due_today'
  return 'scheduled'
}

export function monthlyEquivalent(rawRule) {
  const s = scheduleOf(rawRule)
  const daysPerOccurrence = new Decimal(s.value).times(UNIT_FACTORS[s.unit] ?? '1')
  return new Decimal(rawRule?.amount || 0).times(AVG_DAYS_PER_MONTH).div(daysPerOccurrence).toFixed(2)
}

const LEGACY_BY_UNIT = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }

export function toLegacyFrequency(unit, value) {
  if (unit === 'week' && value === 2) return 'biweekly'
  return LEGACY_BY_UNIT[unit] || 'monthly'
}

export function initialNextDate(rawRule, todayStr) {
  const s = scheduleOf(rawRule)
  if (!s.startDate || !isDateStr(todayStr)) return null
  return occurrenceAtIndex(s, firstIndexAtOrAfter(s, todayStr))
}

function isRealDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const { year, month, day } = parts(value)
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

// occurrenceDates stops scanning after MAX_SCAN iterations, so the endpoints
// that project must never be handed an unbounded window.
const MAX_WINDOW_DAYS = 400

export function resolveProjectionWindow(from, to) {
  if (!isRealDateStr(from) || !isRealDateStr(to)) return { ok: false, error: 'invalid_date_range' }
  const days = dayNum(to) - dayNum(from) + 1
  if (days < 1 || days > MAX_WINDOW_DAYS) return { ok: false, error: 'invalid_date_range' }
  return { ok: true, from, to }
}

export const PATCHABLE_COLUMNS = [
  'account_id', 'category_id', 'amount', 'currency', 'type', 'note', 'is_active',
  'interval_unit', 'interval_value', 'billing_anchor_day', 'start_date', 'end_date',
  'cancellation_date', 'auto_renew', 'payment_limit', 'notify_days_before'
]

export function buildSchedulePatch(body) {
  const fields = []
  const values = []
  for (const column of PATCHABLE_COLUMNS) {
    if (!body || body[column] === undefined) continue
    fields.push(`${column} = $${values.length + 1}`)
    values.push(body[column])
  }
  return { fields, values, empty: fields.length === 0 }
}

export function frequencyToSchedule(frequency) {
  const legacy = LEGACY_FREQUENCIES[frequency]
  return legacy ? { unit: legacy.unit, value: legacy.value } : null
}
