import { describe, it, expect } from 'vitest'
import { debtPayload, canUndoDebtDelete, debtHadProgress } from './debts.js'

describe('canUndoDebtDelete', () => {
  it('allows undo only for a plain debt with nothing kept or unmatched', () => {
    expect(canUndoDebtDelete({ hadProgress: false, kept: [], unmatched: [] })).toBe(true)
    expect(canUndoDebtDelete({ hadProgress: false })).toBe(true)
  })

  it('refuses when payments existed, a booking was kept or a payment was unmatched', () => {
    expect(canUndoDebtDelete({ hadProgress: true })).toBe(false)
    expect(canUndoDebtDelete({ hadProgress: false, kept: [70] })).toBe(false)
    expect(canUndoDebtDelete({ hadProgress: false, unmatched: [{ id: 1, amount: '5', currency: 'USD' }] })).toBe(false)
  })
})

describe('debtHadProgress', () => {
  it('sees payments and paid or skipped installments', () => {
    expect(debtHadProgress({ paid_amount: 0, installments: [{ status: 'due' }] })).toBe(false)
    expect(debtHadProgress({ paid_amount: 0 })).toBe(false)
    expect(debtHadProgress({ paid_amount: 12.5, installments: [] })).toBe(true)
    expect(debtHadProgress({ paid_amount: 0, installments: [{ status: 'due' }, { status: 'skipped' }] })).toBe(true)
    expect(debtHadProgress({ paid_amount: 0, installments: [{ status: 'paid' }] })).toBe(true)
  })
})

const base = { name: 'Loan', counterparty: 'Bob', amount: 100, currency: 'USD', type: 'borrow', due_date: '', description: '', account_id: null }

describe('debtPayload', () => {
  it('omits an empty due date', () => {
    expect(debtPayload(base)).not.toHaveProperty('due_date')
  })

  it('keeps the calendar day of a date or ISO timestamp as is', () => {
    expect(debtPayload({ ...base, due_date: '2026-03-05' }).due_date).toBe('2026-03-05')
    expect(debtPayload({ ...base, due_date: '2026-03-05T00:00:00.000Z' }).due_date).toBe('2026-03-05')
  })

  it('turns the editor\'s decimal string into a number, keeping tiny amounts', () => {
    expect(debtPayload({ ...base, amount: '0.0000005' }).amount).toBe(5e-7)
    expect(debtPayload({ ...base, amount: '12,5' }).amount).toBe(12.5)
    expect(debtPayload({ ...base, amount: 40 }).amount).toBe(40)
  })

  it('drops fields the API does not accept', () => {
    const payload = debtPayload({ ...base, id: 4, remaining: 10, paid_amount: 90, owner_login: 'x' })
    expect(Object.keys(payload).sort()).toEqual(['account_id', 'amount', 'counterparty', 'currency', 'description', 'name', 'type'])
  })
})
