import { describe, it, expect } from 'vitest'
import {
  parseUnits, formatUnits, currencyDigits, splitInstallments, checkSchedule, rescaleSchedule,
  isScheduleLocked, installmentProgress, schedulePayload, shiftMonths, shiftDays,
  isInstallmentRow, isIncomingRow, occurrenceKey, canEditRow, amountToText, sameAmount, installmentActions
} from './installments.js'

const sumOf = rows => rows.reduce((sum, row) => sum + parseUnits(row.amount), 0n)

describe('parseUnits / formatUnits', () => {
  it('reads plain decimals exactly, comma or dot', () => {
    expect(parseUnits('12.5')).toBe(parseUnits('12,50'))
    expect(parseUnits(100.5)).toBe(parseUnits('100.500000000000'))
    expect(formatUnits(parseUnits('33.330000000000'))).toBe('33.33')
    expect(formatUnits(parseUnits('100'))).toBe('100.00')
    expect(formatUnits(parseUnits('0.000001'))).toBe('0.000001')
  })

  it('rejects anything that is not a plain non-negative decimal', () => {
    for (const bad of ['', 'abc', '1e3', '-5', '1.1234567890123', null, undefined, NaN, '1 000']) {
      expect(parseUnits(bad)).toBeNull()
    }
  })
})

describe('currencyDigits', () => {
  it('follows the currency and never drops digits the amount uses', () => {
    expect(currencyDigits('USD')).toBe(2)
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('USD', '0.00123')).toBe(5)
    expect(currencyDigits('BHD')).toBe(3)
  })

  it('uses 8 digits for codes ISO 4217 does not know, like the backend', () => {
    expect(currencyDigits('BTC')).toBe(8)
    expect(currencyDigits('USDT')).toBe(8)
    expect(currencyDigits('btc')).toBe(8)
    expect(currencyDigits('')).toBe(8)
    expect(currencyDigits(undefined)).toBe(8)
  })

  it('splits 0.001 BTC in three without losing a satoshi', () => {
    const result = splitInstallments({
      total: '0.001', count: 3, startDate: '2026-01-01', digits: currencyDigits('BTC', '0.001')
    })
    expect(result.rows.map(row => row.amount)).toEqual(['0.00033333', '0.00033333', '0.00033334'])
    expect(sumOf(result.rows)).toBe(parseUnits('0.001'))
  })
})

describe('amountToText / sameAmount', () => {
  it('keeps tiny and long decimals exact, without exponent notation', () => {
    expect(amountToText('100.00')).toBe('100')
    expect(amountToText('0.000000500000')).toBe('0.0000005')
    expect(amountToText('123456789.123456789')).toBe('123456789.123456789')
    expect(amountToText(null)).toBe('')
    expect(amountToText('5e-7')).toBe('5e-7')
  })

  it('compares amounts as numbers, not as text', () => {
    expect(sameAmount('100.00', '100')).toBe(true)
    expect(sameAmount('100,5', 100.5)).toBe(true)
    expect(sameAmount('100', '100.01')).toBe(false)
    expect(sameAmount('x', 'x')).toBe(false)
  })
})

describe('installmentActions', () => {
  it('offers pay / skip while due, and the matching undo afterwards', () => {
    expect(installmentActions('due')).toEqual(['pay', 'skip'])
    expect(installmentActions('paid')).toEqual(['unpay'])
    expect(installmentActions('skipped')).toEqual(['unskip'])
  })
})

describe('canEditRow', () => {
  it('prefers can_edit, falls back to is_owner, then to the given default', () => {
    expect(canEditRow({ can_edit: true, is_owner: false })).toBe(true)
    expect(canEditRow({ can_edit: false, is_owner: true })).toBe(false)
    expect(canEditRow({ is_owner: false })).toBe(false)
    expect(canEditRow({ is_owner: true }, false)).toBe(true)
    expect(canEditRow({}, false)).toBe(false)
    expect(canEditRow({})).toBe(true)
  })
})

describe('date helpers', () => {
  it('keeps the month anchor (Jan 31 -> Feb 28 -> Mar 31) and crosses year ends', () => {
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonths('2026-01-31', 2)).toBe('2026-03-31')
    expect(shiftMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(shiftDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})

describe('splitInstallments', () => {
  it('puts the remainder into the last row: 100 / 3', () => {
    const res = splitInstallments({ total: '100', count: 3, startDate: '2026-11-01' })
    expect(res.ok).toBe(true)
    expect(res.rows.map(r => r.amount)).toEqual(['33.33', '33.33', '33.34'])
    expect(sumOf(res.rows)).toBe(parseUnits('100'))
  })

  it('keeps the exact sum for odd totals and digits', () => {
    const res = splitInstallments({ total: 1000.07, count: 7, startDate: '2026-01-31', digits: 2 })
    expect(sumOf(res.rows)).toBe(parseUnits('1000.07'))
    expect(res.rows.map(r => r.due_date).slice(0, 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    const yen = splitInstallments({ total: '1000', count: 3, startDate: '2026-01-01', digits: 0 })
    expect(yen.rows.map(r => r.amount)).toEqual(['333.00', '333.00', '334.00'])
  })

  it('steps by weeks and days', () => {
    const weeks = splitInstallments({ total: '30', count: 3, startDate: '2026-12-25', unit: 'week', step: 2 })
    expect(weeks.rows.map(r => r.due_date)).toEqual(['2026-12-25', '2027-01-08', '2027-01-22'])
    const days = splitInstallments({ total: '30', count: 2, startDate: '2026-02-27', unit: 'day', step: 2 })
    expect(days.rows.map(r => r.due_date)).toEqual(['2026-02-27', '2026-03-01'])
  })

  it('handles a single installment', () => {
    const res = splitInstallments({ total: '45.5', count: 1, startDate: '2026-11-01' })
    expect(res.rows).toEqual([{ due_date: '2026-11-01', amount: '45.50' }])
  })

  it('refuses nonsense and amounts too small to split', () => {
    expect(splitInstallments({ total: '100', count: 0, startDate: '2026-11-01' }).error).toBe('invalid')
    expect(splitInstallments({ total: '100', count: 3, startDate: '2026-02-30' }).error).toBe('invalid')
    expect(splitInstallments({ total: '', count: 3, startDate: '2026-11-01' }).error).toBe('invalid')
    expect(splitInstallments({ total: '0.02', count: 3, startDate: '2026-11-01' }).error).toBe('too_small')
  })
})

describe('checkSchedule', () => {
  const rows = [
    { due_date: '2026-11-01', amount: '33.33' },
    { due_date: '2026-12-01', amount: '66.67' }
  ]

  it('matches only when the exact sum equals the debt amount', () => {
    expect(checkSchedule(rows, 100).matches).toBe(true)
    expect(checkSchedule(rows, '100.00').matches).toBe(true)
    const off = checkSchedule(rows, 100.01)
    expect(off.matches).toBe(false)
    expect(off.diff).toBe('-0.01')
    expect(off.sum).toBe('100.00')
  })

  it('does not drift like floats do', () => {
    const tenths = [0.1, 0.2].map((amount, i) => ({ due_date: `2026-11-0${i + 1}`, amount: String(amount) }))
    expect(checkSchedule(tenths, 0.3).matches).toBe(true)
  })

  it('flags empty, invalid and duplicate rows', () => {
    expect(checkSchedule([], 100).error).toBe('empty')
    expect(checkSchedule([{ due_date: '2026-11-01', amount: '' }], 100).error).toBe('invalid')
    expect(checkSchedule([{ due_date: '', amount: '100' }], 100).matches).toBe(false)
    const dup = checkSchedule([{ due_date: '2026-11-01', amount: '50' }, { due_date: '2026-11-01', amount: '50' }], 100)
    expect(dup.error).toBe('duplicate')
    expect(dup.matches).toBe(false)
  })

  it('never matches an unusable debt amount', () => {
    expect(checkSchedule(rows, '').matches).toBe(false)
    expect(checkSchedule(rows, '').diff).toBeNull()
  })
})

describe('rescaleSchedule', () => {
  it('scales proportionally and keeps the new total exact', () => {
    const rows = [
      { due_date: '2026-11-01', amount: '50.00' },
      { due_date: '2026-12-01', amount: '25.00' },
      { due_date: '2027-01-01', amount: '25.00' }
    ]
    const scaled = rescaleSchedule(rows, 200)
    expect(scaled.map(r => r.amount)).toEqual(['100.00', '50.00', '50.00'])
    expect(scaled.map(r => r.due_date)).toEqual(rows.map(r => r.due_date))
    const odd = rescaleSchedule(rows, '100.01')
    expect(sumOf(odd)).toBe(parseUnits('100.01'))
  })

  it('gives up instead of producing an empty row', () => {
    const rows = [
      { due_date: '2026-11-01', amount: '99.98' },
      { due_date: '2026-12-01', amount: '0.01' },
      { due_date: '2027-01-01', amount: '0.01' }
    ]
    expect(rescaleSchedule(rows, '1.00', 2)).toBeNull()
    expect(rescaleSchedule([], 100)).toBeNull()
    expect(rescaleSchedule(rows, 'x')).toBeNull()
  })
})

describe('calendar row helpers', () => {
  const sub = { rule_id: 7, date: '2026-11-01', type: 'income' }
  const inst = { kind: 'debt_installment', installment_id: 7, date: '2026-11-01', debt_type: 'borrow' }

  it('treats a missing kind as a subscription', () => {
    expect(isInstallmentRow(sub)).toBe(false)
    expect(isInstallmentRow(inst)).toBe(true)
  })

  it('takes the direction from type or debt_type', () => {
    expect(isIncomingRow(sub)).toBe(true)
    expect(isIncomingRow(inst)).toBe(false)
    expect(isIncomingRow({ ...inst, debt_type: 'lend' })).toBe(true)
  })

  it('keys a rule and an installment with the same id apart', () => {
    expect(occurrenceKey(sub)).not.toBe(occurrenceKey(inst))
    expect(occurrenceKey(inst)).toBe('i7-2026-11-01')
  })
})

describe('schedule state helpers', () => {
  it('locks on any installment that is not due', () => {
    expect(isScheduleLocked([{ status: 'due' }, { status: 'due' }])).toBe(false)
    expect(isScheduleLocked([{ status: 'due' }, { status: 'skipped' }])).toBe(true)
    expect(isScheduleLocked(undefined)).toBe(false)
  })

  it('counts paid installments', () => {
    expect(installmentProgress([{ status: 'paid' }, { status: 'skipped' }, { status: 'due' }])).toEqual({ total: 3, paid: 1 })
    expect(installmentProgress(null)).toEqual({ total: 0, paid: 0 })
  })

  it('sends exact decimal strings', () => {
    expect(schedulePayload([{ key: 1, due_date: '2026-11-01', amount: '33,3' }]))
      .toEqual({ rows: [{ due_date: '2026-11-01', amount: '33.3' }] })
  })
})
