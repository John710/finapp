import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  currencyDigits,
  installmentStatus,
  normalizeSchedule,
  parseInstallmentAmount,
  projectInstallments,
  scheduleMatchesDebt,
  splitSchedule
} from '../services/debt-schedule.js'

const sum = rows => rows.reduce((acc, row) => acc.plus(row.amount), new Decimal(0)).toFixed()

describe('splitSchedule', () => {
  it('splits 100 into three with the remainder on the last installment', () => {
    const { ok, rows } = splitSchedule('100.000000000000', 3, '2026-01-15')
    expect(ok).toBe(true)
    expect(rows.map(r => r.amount)).toEqual(['33.33', '33.33', '33.34'])
    expect(sum(rows)).toBe('100')
    expect(rows.map(r => r.position)).toEqual([1, 2, 3])
    expect(rows.map(r => r.due_date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('keeps the sum exact on cent-level rounding', () => {
    const { rows } = splitSchedule('0.05', 3, '2026-01-01')
    expect(rows.map(r => r.amount)).toEqual(['0.01', '0.01', '0.03'])
    expect(sum(rows)).toBe('0.05')
    const big = splitSchedule('999999999999.99', 7, '2026-01-01').rows
    expect(sum(big)).toBe('999999999999.99')
    expect(scheduleMatchesDebt(big, '999999999999.990000000000')).toBe(true)
  })

  it('gives the whole amount to a single installment', () => {
    const { rows } = splitSchedule('250.5', 1, '2026-05-31')
    expect(rows).toEqual([{ position: 1, due_date: '2026-05-31', amount: '250.5' }])
  })

  it('cuts shares at the currency precision', () => {
    expect(splitSchedule('1000', 3, '2026-01-01', {}, currencyDigits('JPY')).rows.map(r => r.amount)).toEqual(['333', '333', '334'])
    expect(splitSchedule('1', 3, '2026-01-01', {}, currencyDigits('BTC')).rows.map(r => r.amount))
      .toEqual(['0.33333333', '0.33333333', '0.33333334'])
  })

  it('keeps the month anchor: 31 → 28 → 31', () => {
    const { rows } = splitSchedule('300', 4, '2026-01-31')
    expect(rows.map(r => r.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    const leap = splitSchedule('300', 2, '2028-01-31')
    expect(leap.rows.map(r => r.due_date)).toEqual(['2028-01-31', '2028-02-29'])
  })

  it('steps by weeks, days and multi-month intervals', () => {
    expect(splitSchedule('20', 3, '2026-12-28', { unit: 'week' }).rows.map(r => r.due_date))
      .toEqual(['2026-12-28', '2027-01-04', '2027-01-11'])
    expect(splitSchedule('20', 2, '2026-02-27', { unit: 'day', value: 3 }).rows.map(r => r.due_date))
      .toEqual(['2026-02-27', '2026-03-02'])
    expect(splitSchedule('20', 2, '2026-08-31', { unit: 'month', value: 6 }).rows.map(r => r.due_date))
      .toEqual(['2026-08-31', '2027-02-28'])
  })

  it('refuses a split whose share rounds to nothing, and bad input', () => {
    expect(splitSchedule('0.02', 3, '2026-01-01')).toEqual({ ok: false, error: 'installments_too_small' })
    expect(splitSchedule('100', 0, '2026-01-01').ok).toBe(false)
    expect(splitSchedule('100', 501, '2026-01-01').ok).toBe(false)
    expect(splitSchedule('100', 2, '2026-02-30').ok).toBe(false)
    expect(splitSchedule('100', 2, '2026-01-01', { unit: 'year' }).ok).toBe(false)
    expect(splitSchedule('-5', 2, '2026-01-01').ok).toBe(false)
  })
})

describe('normalizeSchedule', () => {
  it('sorts by date, numbers positions and keeps amounts exact', () => {
    const { ok, rows } = normalizeSchedule([
      { due_date: '2026-03-01', amount: '40.10' },
      { due_date: '2026-01-01', amount: 30 },
      { due_date: '2026-02-01', amount: '29.9' }
    ])
    expect(ok).toBe(true)
    expect(rows).toEqual([
      { position: 1, due_date: '2026-01-01', amount: '30' },
      { position: 2, due_date: '2026-02-01', amount: '29.9' },
      { position: 3, due_date: '2026-03-01', amount: '40.1' }
    ])
    expect(scheduleMatchesDebt(rows, '100.000000000000')).toBe(true)
    expect(scheduleMatchesDebt(rows, '100.01')).toBe(false)
  })

  it('rejects two installments on one date', () => {
    expect(normalizeSchedule([
      { due_date: '2026-01-01', amount: 1 },
      { due_date: '2026-01-01', amount: 2 }
    ])).toEqual({ ok: false, error: 'installment_duplicate_date', params: { date: '2026-01-01' } })
  })

  it('rejects non-positive, non-decimal or over-precise amounts and impossible dates', () => {
    for (const row of [
      { due_date: '2026-01-01', amount: 0 },
      { due_date: '2026-01-01', amount: '-1' },
      { due_date: '2026-01-01', amount: '1e3' },
      { due_date: '2026-01-01', amount: '0x10' },
      { due_date: '2026-01-01', amount: '0.0000000000001' },
      { due_date: '2026-01-01', amount: '1000000000000' },
      { due_date: '2026-02-29', amount: 1 },
      { due_date: '2026-1-1', amount: 1 }
    ]) {
      expect(normalizeSchedule([row]).ok).toBe(false)
    }
  })

  it('accepts an empty schedule', () => {
    expect(normalizeSchedule([])).toEqual({ ok: true, rows: [] })
  })
})

describe('parseInstallmentAmount', () => {
  it('parses decimal text without going through a float', () => {
    expect(parseInstallmentAmount('12345678901.123456789012').toFixed()).toBe('12345678901.123456789012')
    expect(parseInstallmentAmount('abc')).toBe(null)
  })
})

describe('installmentStatus', () => {
  it('keeps paid and skipped, flags a past due date as overdue', () => {
    expect(installmentStatus({ status: 'paid', due_date: '2026-01-01' }, '2026-06-01')).toBe('paid')
    expect(installmentStatus({ status: 'skipped', due_date: '2026-01-01' }, '2026-06-01')).toBe('skipped')
    expect(installmentStatus({ status: 'due', due_date: '2026-05-31' }, '2026-06-01')).toBe('overdue')
    expect(installmentStatus({ status: 'due', due_date: '2026-06-01' }, '2026-06-01')).toBe('due')
  })
})

describe('projectInstallments', () => {
  const debts = [
    { id: 1, user_id: 7, name: 'Car', counterparty: 'Bank', currency: 'EUR', type: 'borrow', status: 'active', is_owner: true, can_edit: true },
    // a 'view' share: seen, not actionable
    { id: 2, user_id: 9, name: 'Loan', counterparty: 'Ann', currency: 'USD', type: 'lend', status: 'active', is_owner: false, can_edit: false },
    { id: 3, user_id: 7, name: 'Old', counterparty: 'Bob', currency: 'USD', type: 'lend', status: 'paid', is_owner: true, can_edit: true }
  ]
  const installments = [
    { id: 10, debt_id: 1, due_date: '2026-03-01', amount: '50.000000000000', status: 'due' },
    { id: 11, debt_id: 1, due_date: '2026-02-01', amount: '50.000000000000', status: 'paid' },
    { id: 12, debt_id: 2, due_date: '2026-02-01', amount: '20', status: 'skipped' },
    { id: 13, debt_id: 2, due_date: '2026-05-01', amount: '20', status: 'due' },
    { id: 14, debt_id: 3, due_date: '2026-02-15', amount: '5', status: 'due' },
    { id: 15, debt_id: 99, due_date: '2026-02-15', amount: '5', status: 'due' }
  ]

  it('returns the installments in the window, sorted by date then id, in the calendar shape', () => {
    const rows = projectInstallments(debts, installments, '2026-02-01', '2026-03-31')
    expect(rows.map(r => r.installment_id)).toEqual([11, 12, 10])
    expect(rows[0]).toEqual({
      kind: 'debt_installment',
      installment_id: 11,
      debt_id: 1,
      user_id: 7,
      name: 'Car · Bank',
      date: '2026-02-01',
      amount: '50.000000000000',
      currency: 'EUR',
      debt_type: 'borrow',
      paid: true,
      skipped: false,
      is_owner: true,
      can_edit: true
    })
    expect(rows[1]).toMatchObject({ skipped: true, paid: false, is_owner: false, can_edit: false, debt_type: 'lend', user_id: 9 })
  })

  it('leaves out installments outside the window, of paid-off debts and of debts not passed in', () => {
    const rows = projectInstallments(debts, installments, '2026-02-02', '2026-02-28')
    expect(rows).toEqual([])
    expect(projectInstallments(debts, installments, '2026-04-01', '2026-03-01')).toEqual([])
    expect(projectInstallments(debts, installments, 'bad', '2026-03-01')).toEqual([])
  })
})
