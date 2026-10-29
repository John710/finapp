import Decimal from 'decimal.js'
import cc from 'currency-codes'
import { isRealDateStr, monthDay, monthIndex, shiftDays } from './recurring-schedule.js'

// Installment schedules of a debt: pure math, no database — the pattern of
// recurring-schedule.js, whose month-anchor algorithm the dates reuse.
//
// Results are { ok: true, rows } or { ok: false, error } where error is an
// errors.* i18n key, so routes answer without re-validating.

export const MAX_INSTALLMENTS = 500

// numeric(24,12) holds 24 significant digits; the default precision (20) could
// round a sum of such amounts, and the schedule sum must be exact.
const D = Decimal.clone({ precision: 40 })

const MAX_AMOUNT = new D('1e12')
const MAX_SCALE = 12
// A code ISO 4217 does not know is a crypto ticker: kept to 8 decimals.
const CRYPTO_DIGITS = 8
const DAY_UNITS = { day: 1, week: 7 }

const fail = (error, params) => ({ ok: false, error, ...(params ? { params } : {}) })

// Minor-unit digits of a currency: ISO 4217 for fiat (JPY 0, USD 2, BHD 3).
export function currencyDigits(currency) {
  const entry = typeof currency === 'string' && currency ? cc.code(currency) : null
  return Number.isInteger(entry?.digits) ? entry.digits : CRYPTO_DIGITS
}

// A positive amount that fits numeric(24,12) exactly, or null. Strings must be
// plain decimals: Decimal itself would also take '1e3' or '0x10'.
export function parseInstallmentAmount(value) {
  let amount
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    amount = new D(value)
  } else if (typeof value === 'string' && /^\d{1,12}(\.\d+)?$/.test(value)) {
    amount = new D(value)
  } else {
    return null
  }
  if (amount.lte(0) || amount.gte(MAX_AMOUNT) || amount.decimalPlaces() > MAX_SCALE) return null
  return amount
}

function dueDateAt(startDate, index, unit, value) {
  if (unit === 'month') return monthDay(monthIndex(startDate) + index * value, Number(startDate.slice(8, 10)))
  return shiftDays(startDate, index * value * DAY_UNITS[unit])
}

/**
 * `count` installments of `total`, the first on `startDate`, then every
 * `interval.value` `interval.unit`s (day | week | month; month keeps the start
 * day as anchor: Jan 31 → Feb 28 → Mar 31). Each share is cut down to the
 * currency's `digits`; the last installment takes the remainder, so the rows
 * add up to `total` exactly (100 / 3 → 33.33, 33.33, 33.34).
 */
export function splitSchedule(total, count, startDate, interval = {}, digits = 2) {
  const unit = interval.unit ?? 'month'
  const value = interval.value ?? 1
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) return fail('installments_invalid')
  if (!isRealDateStr(startDate)) return fail('installments_invalid')
  if ((unit !== 'month' && !DAY_UNITS[unit]) || !Number.isInteger(value) || value < 1) return fail('installments_invalid')
  if (!Number.isInteger(digits) || digits < 0 || digits > MAX_SCALE) return fail('installments_invalid')
  const sum = parseInstallmentAmount(typeof total === 'number' ? total : String(total))
  if (!sum) return fail('installments_invalid')

  const share = sum.div(count).toDecimalPlaces(digits, D.ROUND_DOWN)
  if (share.lte(0)) return fail('installments_too_small')
  const rows = []
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? sum.minus(share.times(count - 1)) : share
    rows.push({ position: i + 1, due_date: dueDateAt(startDate, i, unit, value), amount: amount.toFixed() })
  }
  return { ok: true, rows }
}

/**
 * Validates hand-entered rows `[{ due_date, amount }]`: real dates, positive
 * amounts that fit the column, no two on one day. Sorted by date and numbered
 * 1..N, amounts as exact decimal strings.
 */
export function normalizeSchedule(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_INSTALLMENTS) return fail('installments_invalid')
  const parsed = []
  for (const row of rows) {
    if (!isRealDateStr(row?.due_date)) return fail('installments_invalid')
    const amount = parseInstallmentAmount(row.amount)
    if (!amount) return fail('installments_invalid')
    parsed.push({ due_date: row.due_date, amount })
  }
  parsed.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].due_date === parsed[i - 1].due_date) {
      return fail('installment_duplicate_date', { date: parsed[i].due_date })
    }
  }
  return {
    ok: true,
    rows: parsed.map((row, i) => ({ position: i + 1, due_date: row.due_date, amount: row.amount.toFixed() }))
  }
}

// Exact sum of a schedule's amounts (strings or numbers).
export function scheduleTotal(rows) {
  return rows.reduce((sum, row) => sum.plus(new D(row.amount)), new D(0))
}

// The invariant of a schedule: its rows add up to the debt amount, exactly.
export function scheduleMatchesDebt(rows, debtAmount) {
  return scheduleTotal(rows).eq(new D(debtAmount))
}

/**
 * paid / skipped as stored; a due installment whose date has passed is
 * overdue. `today` is a 'YYYY-MM-DD' calendar day.
 */
export function installmentStatus(row, today) {
  if (row?.status === 'paid' || row?.status === 'skipped') return row.status
  if (isRealDateStr(today) && typeof row?.due_date === 'string' && row.due_date < today) return 'overdue'
  return 'due'
}

/**
 * Calendar rows for the installments that fall in [from, to], in the flat
 * shape of projectOccurrences, tagged kind 'debt_installment'. `debts` are the
 * debts the caller may see (with is_owner, can_edit); installments of any other debt,
 * and of debts already paid off, are left out.
 */
export function projectInstallments(debts, installments, from, to) {
  if (!isRealDateStr(from) || !isRealDateStr(to) || from > to) return []
  const open = new Map(debts.filter(debt => debt.status !== 'paid').map(debt => [debt.id, debt]))
  const rows = []
  for (const installment of installments) {
    const debt = open.get(installment.debt_id)
    if (!debt || installment.due_date < from || installment.due_date > to) continue
    rows.push({
      kind: 'debt_installment',
      installment_id: installment.id,
      debt_id: debt.id,
      user_id: debt.user_id,
      name: `${debt.name} · ${debt.counterparty}`,
      date: installment.due_date,
      amount: String(installment.amount),
      currency: debt.currency,
      debt_type: debt.type,
      paid: installment.status === 'paid',
      skipped: installment.status === 'skipped',
      is_owner: debt.is_owner === true,
      // pay / skip / undo are open to the owner and to an 'edit' share
      can_edit: debt.can_edit === true
    })
  }
  rows.sort((a, b) => (a.date === b.date ? a.installment_id - b.installment_id : a.date < b.date ? -1 : 1))
  return rows
}
