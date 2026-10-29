import { describe, it, expect } from 'vitest'
import { debtPayload } from './debts.js'

const base = { name: 'Loan', counterparty: 'Bob', amount: 100, currency: 'USD', type: 'borrow', due_date: '', description: '', account_id: null }

describe('debtPayload', () => {
  it('omits an empty due date', () => {
    expect(debtPayload(base)).not.toHaveProperty('due_date')
  })

  it('keeps the calendar day of a date or ISO timestamp as is', () => {
    expect(debtPayload({ ...base, due_date: '2026-03-05' }).due_date).toBe('2026-03-05')
    expect(debtPayload({ ...base, due_date: '2026-03-05T00:00:00.000Z' }).due_date).toBe('2026-03-05')
  })

  it('drops fields the API does not accept', () => {
    const payload = debtPayload({ ...base, id: 4, remaining: 10, paid_amount: 90, owner_login: 'x' })
    expect(Object.keys(payload).sort()).toEqual(['account_id', 'amount', 'counterparty', 'currency', 'description', 'name', 'type'])
  })
})
