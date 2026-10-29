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

export function shiftDays(dateStr, days) {
  const date = new Date(dayNum(dateStr) * DAY_MS + days * DAY_MS)
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

// 'YYYY-MM' shifted by whole months — pure string arithmetic, so no process
// timezone can move a month boundary.
export function shiftMonth(key, delta) {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + delta
  const year = Math.floor(index / 12)
  return `${year}-${String(index - year * 12 + 1).padStart(2, '0')}`
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthIndex(dateStr) {
  const { year, month } = parts(dateStr)
  return year * 12 + (month - 1)
}

// The anchor day is kept unless the target month is shorter, so Jan 31 + 1 month
// is Feb 28 but Jan 31 + 2 months is still Mar 31 — no ratchet, unlike `date + INTERVAL`.
// Shared with debt-schedule.js so installments and subscriptions anchor alike.
export function monthDay(monthIdx, anchorDay) {
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

// The same flattened projection the calendar, the dashboard and the reports read:
// keeping the label order and the paid/skipped flags here means all three agree.
// Rows are tagged kind 'subscription' so they merge with the debt installments
// of debt-schedule.js projectInstallments() (see mergeOccurrences).
export function projectOccurrences(rules, flags = {}, from, to) {
  const { paid = new Map(), skipped = new Map() } = flags
  const occurrences = []
  for (const rule of rules) {
    const paidSet = paid.get(rule.id) ?? new Set()
    const skipSet = skipped.get(rule.id) ?? new Set()
    for (const date of occurrenceDates(rule, from, to)) {
      occurrences.push({
        kind: 'subscription',
        rule_id: rule.id,
        // A shared rule reaches one calendar feed per owner, so the UID needs the
        // owner id, not only the rule id.
        user_id: rule.user_id,
        name: rule.note || rule.category_name || rule.account_name,
        date,
        amount: rule.amount,
        currency: rule.currency,
        type: rule.type,
        account_id: rule.account_id,
        account_name: rule.account_name,
        category_name: rule.category_name,
        paid: paidSet.has(date),
        skipped: skipSet.has(date),
        is_active: rule.is_active,
        // Only the owner may pay, skip or undo (routes answer 403 otherwise).
        is_owner: rule.is_owner === true
      })
    }
  }
  occurrences.sort((a, b) => (a.date === b.date ? a.rule_id - b.rule_id : a.date < b.date ? -1 : 1))
  return occurrences
}

const occurrenceId = occurrence => (occurrence.kind === 'debt_installment' ? occurrence.installment_id : occurrence.rule_id)

/**
 * One calendar list from the subscription and the debt-installment
 * projections: by date, then kind, then the row's own id — a stable order, so
 * the chips of one day keep their places between requests.
 */
export function mergeOccurrences(...lists) {
  return lists.flat().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.kind !== b.kind) return String(a.kind) < String(b.kind) ? -1 : 1
    return occurrenceId(a) - occurrenceId(b)
  })
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

// What a rule costs per average month, in its own currency, kept to the
// numeric(24,12) scale. Not rounded to cents: 0.0001 BTC a week must not become
// 0 before a caller converts and sums it. Callers round for display only
// (toDisplayNumber, or currencyDigits() of debt-schedule.js).
export function monthlyEquivalent(rawRule) {
  const s = scheduleOf(rawRule)
  const daysPerOccurrence = new Decimal(s.value).times(UNIT_FACTORS[s.unit] ?? '1')
  return new Decimal(rawRule?.amount || 0).times(AVG_DAYS_PER_MONTH).div(daysPerOccurrence).toDecimalPlaces(12).toFixed()
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

export function isRealDateStr(value) {
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

// Every reader of recurring_rules must cast the DATE columns to text: pg hands
// back a local-midnight Date, and the JSON would then carry the day before the
// schedule means whenever the container is not on UTC.
export const RULE_FIELDS = [
  'id', 'user_id', 'account_id', 'category_id', 'amount', 'currency', 'type', 'frequency',
  'interval_unit', 'interval_value', 'billing_anchor_day', 'start_date', 'next_date', 'end_date',
  'cancellation_date', 'auto_renew', 'payment_limit', 'occurrences_paid', 'last_run_date',
  'notify_days_before', 'note', 'is_active', 'created_at', 'updated_at'
]

const RULE_TEXT_FIELDS = new Set(['amount', 'start_date', 'next_date', 'end_date', 'cancellation_date', 'last_run_date'])

export function ruleColumns(prefix) {
  return RULE_FIELDS.map(field =>
    RULE_TEXT_FIELDS.has(field) ? `${prefix}${field}::text AS ${field}` : `${prefix}${field}`
  ).join(', ')
}

export const CATCHUP_LIMIT = 10

// What one cron pass owes a rule: the occurrences to insert, the ones it has to
// rewind because the catch-up cap was reached, and where the cursor ends up.
// When the schedule runs out, the cursor parks on the last allowed day so the
// caller can deactivate the rule without losing the date it stopped on.
export function planRuleRun(rawRule, todayStr, options = {}) {
  const { paid = new Set(), skipped = new Set(), limit = CATCHUP_LIMIT } = options
  const toCreate = []
  const rewound = []
  let cursor = isDateStr(rawRule?.next_date) ? rawRule.next_date : occurrenceAtIndex(scheduleOf(rawRule), 0)
  // An anchor change can leave the stored cursor off-schedule; never create a
  // date the schedule itself does not generate.
  while (cursor && !occurrenceAllowed(rawRule, cursor)) cursor = nextOccurrenceAfter(rawRule, cursor)

  let lastDate = null
  while (cursor && cursor <= todayStr) {
    lastDate = cursor
    if (paid.has(cursor) || skipped.has(cursor)) {
      cursor = nextOccurrenceAfter(rawRule, cursor)
      continue
    }
    if (toCreate.length >= limit) rewound.push(cursor)
    else toCreate.push(cursor)
    cursor = nextOccurrenceAfter(rawRule, cursor)
  }

  if (!cursor) return { toCreate, rewound, nextDate: lastDate, lastDate, finished: true }
  return { toCreate, rewound, nextDate: cursor, lastDate, finished: false }
}
