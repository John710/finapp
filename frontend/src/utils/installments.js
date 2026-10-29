// Debt installment schedules: the exact-sum maths behind the schedule editor.
//
// The server insists that the installments add up to the debt amount exactly
// (422 installments_sum_mismatch), so floats are out. Amounts are decimal
// strings; they are compared as BigInt integers scaled to the 12 decimals the
// numeric(24,12) column holds. Calendar days stay 'YYYY-MM-DD' strings.

export const SCALE = 12
export const MAX_INSTALLMENTS = 500
const UNIT = 10n ** BigInt(SCALE)
const AMOUNT_RE = /^(\d{1,12})(?:\.(\d{1,12}))?$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isRealDate(value) {
  const match = typeof value === 'string' ? DATE_RE.exec(value) : null
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

function formatDay(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function shiftDays(date, days) {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return formatDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

// The start day is the anchor: Jan 31 -> Feb 28 -> Mar 31, not a drift to the 28th.
export function shiftMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = (index % 12) + 1
  return formatDay(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
}

// Same rule as backend/services/debt-schedule.js currencyDigits: ISO 4217 minor
// units for fiat (JPY 0, USD 2, BHD 3), 8 for any code ISO does not know (BTC,
// USDT: crypto tickers). Intl.NumberFormat accepts any three letters and would
// answer 2 for those, so the ISO list comes from Intl.supportedValuesOf.
const CRYPTO_DIGITS = 8
let isoCodes

function isIsoCurrency(currency) {
  if (isoCodes === undefined) {
    try {
      isoCodes = new Set(Intl.supportedValuesOf('currency'))
    } catch {
      // A browser without the list: trust Intl for any three-letter code.
      isoCodes = null
    }
  }
  return isoCodes ? isoCodes.has(currency) : /^[A-Z]{3}$/.test(currency)
}

// Never fewer digits than the amount itself uses.
export function currencyDigits(currency, total) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  let digits = CRYPTO_DIGITS
  if (code && isIsoCurrency(code)) {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits
  }
  const units = parseUnits(total)
  if (units !== null) {
    const used = String(units % UNIT).padStart(SCALE, '0').replace(/0+$/, '').length
    digits = Math.max(digits, used)
  }
  return Math.min(digits, SCALE)
}

// A non-negative plain decimal ("12", "12.5", "12,5") as BigInt units, or null.
export function parseUnits(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    value = String(value)
  }
  if (typeof value !== 'string') return null
  const match = AMOUNT_RE.exec(value.trim().replace(',', '.'))
  if (!match) return null
  return BigInt(match[1]) * UNIT + BigInt((match[2] || '').padEnd(SCALE, '0'))
}

// Units back to a decimal string with at least `minDigits` decimals.
export function formatUnits(units, minDigits = 2) {
  const negative = units < 0n
  const abs = negative ? -units : units
  const whole = abs / UNIT
  let fraction = String(abs % UNIT).padStart(SCALE, '0')
  while (fraction.length > minDigits && fraction.endsWith('0')) fraction = fraction.slice(0, -1)
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * `count` equal parts of `total`, the first on `startDate`, then every `step`
 * `unit`s ('month' | 'week' | 'day'). Each share is cut down to `digits`; the
 * last row takes the remainder, so the rows add up to `total` exactly.
 * Returns { ok: true, rows: [{ due_date, amount }] } or { ok: false, error }
 * with error 'invalid' | 'too_small'.
 */
export function splitInstallments({ total, count, startDate, unit = 'month', step = 1, digits = 2 }) {
  const totalUnits = parseUnits(total)
  if (totalUnits === null || totalUnits <= 0n) return { ok: false, error: 'invalid' }
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) return { ok: false, error: 'invalid' }
  if (!isRealDate(startDate)) return { ok: false, error: 'invalid' }
  if (!['month', 'week', 'day'].includes(unit) || !Number.isInteger(step) || step < 1 || step > 366) {
    return { ok: false, error: 'invalid' }
  }
  const quantum = 10n ** BigInt(SCALE - Math.min(Math.max(digits, 0), SCALE))
  const share = (totalUnits / BigInt(count) / quantum) * quantum
  if (share <= 0n) return { ok: false, error: 'too_small' }
  const rows = []
  for (let i = 0; i < count; i++) {
    const units = i === count - 1 ? totalUnits - share * BigInt(count - 1) : share
    const dueDate = unit === 'month'
      ? shiftMonths(startDate, i * step)
      : shiftDays(startDate, i * step * (unit === 'week' ? 7 : 1))
    rows.push({ due_date: dueDate, amount: formatUnits(units) })
  }
  return { ok: true, rows }
}

/**
 * The editor's verdict on a list of rows against the debt amount:
 * { error: null | 'invalid' | 'duplicate' | 'empty', sum, diff, matches }.
 * `sum` / `diff` are decimal strings (diff = sum - debt amount); `matches` is
 * true only for a valid, non-empty schedule whose sum equals the amount.
 */
export function checkSchedule(rows, debtAmount) {
  const total = parseUnits(debtAmount)
  let sum = 0n
  let invalid = false
  let duplicate = false
  const seen = new Set()
  for (const row of rows) {
    const units = parseUnits(row.amount)
    if (!isRealDate(row.due_date) || units === null || units <= 0n) invalid = true
    if (units !== null) sum += units
    if (seen.has(row.due_date)) duplicate = true
    seen.add(row.due_date)
  }
  let error = null
  if (rows.length === 0) error = 'empty'
  else if (invalid) error = 'invalid'
  else if (duplicate) error = 'duplicate'
  const diff = total === null ? null : sum - total
  return {
    error,
    sum: formatUnits(sum),
    diff: diff === null ? null : formatUnits(diff),
    matches: error === null && total !== null && total > 0n && diff === 0n
  }
}

/**
 * Rows scaled to a new debt amount, each share proportional to the old one and
 * cut down to `digits`; the last row takes the remainder. Null when the old
 * rows are unusable or a row would shrink to nothing (the user edits by hand).
 */
export function rescaleSchedule(rows, newTotal, digits = 2) {
  const target = parseUnits(newTotal)
  if (target === null || target <= 0n || rows.length === 0) return null
  const olds = rows.map(row => parseUnits(row.amount))
  if (olds.some(units => units === null || units <= 0n)) return null
  const oldTotal = olds.reduce((sum, units) => sum + units, 0n)
  const quantum = 10n ** BigInt(SCALE - Math.min(Math.max(digits, 0), SCALE))
  const scaled = []
  let used = 0n
  for (let i = 0; i < rows.length; i++) {
    const units = i === rows.length - 1 ? target - used : (olds[i] * target / oldTotal / quantum) * quantum
    if (units <= 0n) return null
    used += units
    scaled.push({ ...rows[i], amount: formatUnits(units) })
  }
  return scaled
}

// Calendar / dashboard rows: a row without a kind is a subscription occurrence.
export function isInstallmentRow(row) {
  return row?.kind === 'debt_installment'
}

// Money comes in for a subscription of type income and for a lent debt.
export function isIncomingRow(row) {
  return isInstallmentRow(row) ? row.debt_type === 'lend' : row?.type === 'income'
}

export function occurrenceKey(row) {
  const id = isInstallmentRow(row) ? `i${row.installment_id}` : `r${row.rule_id}`
  return `${id}-${row.date}`
}

// Whether the caller may pay / skip / undo this calendar row. The server sends
// `can_edit` (owner or edit share); `is_owner` is the fallback for an older
// answer, `ownerFallback` for a row that carries neither (a rule's own flag).
export function canEditRow(row, ownerFallback = true) {
  if (typeof row?.can_edit === 'boolean') return row.can_edit
  if (typeof row?.is_owner === 'boolean') return row.is_owner
  return ownerFallback
}

// The actions an installment offers in its status; each name is also the
// `debts.installments.<kind>` label and the store call it triggers.
export function installmentActions(status) {
  if (status === 'paid') return ['unpay']
  if (status === 'skipped') return ['unskip']
  return ['pay', 'skip']
}

// The API's decimal string as the editor shows it: no trailing zeros ("100.00"
// -> "100") and never exponent notation. Anything that is not a plain decimal
// comes back as text untouched, so it still shows up (and fails validation).
export function amountToText(value) {
  if (value === null || value === undefined) return ''
  const units = parseUnits(value)
  return units === null ? String(value) : formatUnits(units, 0)
}

// Whether two amounts (decimal strings or numbers) are the same number.
export function sameAmount(a, b) {
  const x = parseUnits(a)
  return x !== null && x === parseUnits(b)
}

// Any installment that is no longer 'due' freezes the schedule (409 installments_locked).
export function isScheduleLocked(installments) {
  return (installments || []).some(item => item.status !== 'due')
}

export function installmentProgress(installments) {
  const list = installments || []
  return { total: list.length, paid: list.filter(item => item.status === 'paid').length }
}

// What the server expects: dates and exact decimal strings, nothing else.
export function schedulePayload(rows) {
  return { rows: rows.map(row => ({ due_date: row.due_date, amount: formatUnits(parseUnits(row.amount), 0) })) }
}
