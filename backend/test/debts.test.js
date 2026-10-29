import { describe, it, expect } from 'vitest'
import debtRoutes, { bookingEditedByHand, debtBookingChanged } from '../routes/debts.js'
import { convertForAccount } from '../services/debt-payments.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

const BTC_RATES = [{ from_currency: 'BTC', to_currency: 'USD', rate: '50000' }]

function ownAccount(overrides = {}) {
  return { id: 3, owner_id: USER, currency: 'USD', type: 'checking', access: 'own', ...overrides }
}

function buildServer(handlers = []) {
  return buildStubServer(debtRoutes, [
    ...handlers,
    { match: /FROM exchange_rates/, rows: () => [] },
    { match: /FROM categories/, rows: () => [{ id: 50 }] }
  ])
}

const statements = (queries, re) => queries.filter(q => re.test(q.sql))

describe('convertForAccount', () => {
  it('converts USD into a crypto account exactly', () => {
    expect(convertForAccount(100, 'USD', 'BTC', BTC_RATES).toString()).toBe('0.002')
  })

  it('passes the same currency through', () => {
    expect(convertForAccount(100, 'USD', 'USD', []).toString()).toBe('100')
  })

  it('returns null instead of the raw amount when no rate exists', () => {
    expect(convertForAccount(100, 'USD', 'XMR', BTC_RATES)).toBe(null)
  })
})

describe('debtBookingChanged', () => {
  const old = { amount: '100.000000000000', currency: 'USD', type: 'borrow', account_id: 3 }
  it('ignores a numerically equal amount', () => {
    expect(debtBookingChanged(old, { amount: 100, currency: 'USD', type: 'borrow', account_id: 3 })).toBe(false)
  })
  it('flags amount, currency, type and account changes', () => {
    expect(debtBookingChanged(old, { ...old, amount: 101 })).toBe(true)
    expect(debtBookingChanged(old, { ...old, currency: 'EUR' })).toBe(true)
    expect(debtBookingChanged(old, { ...old, type: 'lend' })).toBe(true)
    expect(debtBookingChanged(old, { ...old, account_id: null })).toBe(true)
  })
})

describe('POST /debts', () => {
  it('refuses to book a debt whose currency cannot be converted into the account currency', async () => {
    const { app, queries } = buildServer([
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [ownAccount({ currency: 'XMR', type: 'crypto' })] }
    ])
    const res = await app.inject({
      method: 'POST', url: '/debts',
      payload: { name: 'Loan', counterparty: 'Bob', amount: 100, currency: 'USD', type: 'borrow', account_id: 3 }
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('USD')
    expect(statements(queries, /INSERT INTO debts/)).toHaveLength(0)
    expect(statements(queries, /INSERT INTO transactions/)).toHaveLength(0)
    expect(queries.at(-1).sql).toBe('ROLLBACK')
  })

  it('books USD into a BTC account at the converted amount, as exact strings', async () => {
    const { app, queries } = buildServer([
      { match: /FROM exchange_rates/, rows: () => BTC_RATES },
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [ownAccount({ currency: 'BTC', type: 'crypto' })] },
      { match: /INSERT INTO debts/, rows: () => [{ id: 9, name: 'Loan' }] }
    ])
    const res = await app.inject({
      method: 'POST', url: '/debts',
      payload: { name: 'Loan', counterparty: 'Bob', amount: 100, currency: 'USD', type: 'borrow', account_id: 3 }
    })
    expect(res.statusCode).toBe(201)
    const [tx] = statements(queries, /INSERT INTO transactions/)
    expect(tx.params.slice(0, 7)).toEqual([USER, 3, 50, '0.002', 'income', 'debt_created:Loan', USER])
    expect(tx.params[7]).toBe(9)
    const [balance] = statements(queries, /UPDATE accounts SET balance/)
    expect(balance.params).toEqual(['0.002', 3, USER])
  })
})

describe('PUT /debts/:id', () => {
  const stored = { id: 9, name: 'Loan', amount: '100.000000000000', currency: 'USD', type: 'lend', status: 'active', account_id: 3 }
  const body = { name: 'Loan', counterparty: 'Bob', amount: 100, currency: 'USD', type: 'lend', account_id: 3 }

  it('answers 409 when payments exist and the booked amount would change', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: () => [stored] },
      { match: /FROM debt_payments WHERE debt_id/, rows: () => [{ '?column?': 1 }] }
    ])
    const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150 } })
    expect(res.statusCode).toBe(409)
    expect(statements(queries, /UPDATE debts/)).toHaveLength(0)
    expect(statements(queries, /UPDATE accounts/)).toHaveLength(0)
  })

  it('moves the creation booking along when no payments exist', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: () => [stored] },
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [ownAccount()] },
      { match: /FROM transactions t\s+JOIN debts d/, rows: () => [{ id: 70, account_id: 3, user_id: USER, amount: '100.000000000000', type: 'expense' }] },
      { match: /UPDATE debts/, rows: () => [{ ...stored, amount: '150' }] }
    ])
    const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150 } })
    expect(res.statusCode).toBe(200)
    const balances = statements(queries, /UPDATE accounts SET balance/)
    // the old lend booking (-100) is taken off, the new one (-150) applied
    expect(balances.map(q => [q.sql.includes('balance - $1') ? '-' : '+', q.params[0]])).toEqual([['-', '-100'], ['+', '-150']])
    const [tx] = statements(queries, /UPDATE transactions SET account_id/)
    expect(tx.params).toEqual([3, USER, '150', 'expense', 50, 'debt_created:Loan', 70])
  })

  it('keeps stored currency and status when the body omits them', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: () => [stored] },
      { match: /UPDATE debts/, rows: () => [stored] }
    ])
    const { currency: _currency, ...withoutCurrency } = body
    const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: withoutCurrency })
    expect(res.statusCode).toBe(200)
    const [update] = statements(queries, /UPDATE debts/)
    expect(update.sql).toContain('status = COALESCE($8, status)')
    expect(update.params[3]).toBe('USD')
    expect(update.params[7]).toBe(null)
    // nothing booked changed, so the ledger is untouched
    expect(statements(queries, /debt_payments|UPDATE accounts|UPDATE transactions/)).toHaveLength(0)
  })

  it('answers 404 for a debt the caller does not own', async () => {
    const { app, queries } = buildServer()
    const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: body })
    expect(res.statusCode).toBe(404)
    expect(statements(queries, /UPDATE debts/)).toHaveLength(0)
  })
})

describe('POST /debts/:id/payments', () => {
  it('locks the debt row before summing the payments', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [{ id: 9, amount: '100', currency: 'USD', type: 'lend', name: 'Loan', owner_id: USER, access: 'edit' }] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 1 }] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '40', currency: 'USD' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 40 } })
    expect(res.statusCode).toBe(201)
    const [lock] = statements(queries, /FROM debts d WHERE d\.id = \$1/)
    expect(lock.sql).toContain('FOR UPDATE OF d')
    expect(statements(queries, /SET status/)).toHaveLength(0)
  })

  it('refuses a payment into an account with no rate for its currency', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [{ id: 9, amount: '100', currency: 'USD', type: 'lend', name: 'Loan', owner_id: USER, access: 'edit' }] },
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [ownAccount({ currency: 'XMR' })] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 40, account_id: 3 } })
    expect(res.statusCode).toBe(400)
    expect(statements(queries, /INSERT INTO/)).toHaveLength(0)
  })
})

describe('GET /debts', () => {
  it('reads payments stored under the owner and hides invisible account names', async () => {
    const { app, queries } = buildServer([
      { match: /UNION/, rows: () => [{ id: 3 }] },
      { match: /FROM debts d/, rows: () => [{ id: 9, amount: '100', currency: 'USD', user_id: 1 }] },
      { match: /FROM debt_payments/, rows: () => [{ id: 1, debt_id: 9, amount: '30', currency: 'USD' }] }
    ])
    const res = await app.inject({ method: 'GET', url: '/debts' })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0]).toMatchObject({ paid_amount: 30, remaining: 70 })
    const [list] = statements(queries, /FROM debts d/)
    expect(list.sql).toContain('CASE WHEN a.id = ANY($2) THEN a.name ELSE NULL END')
    expect(list.sql).not.toMatch(/LEFT JOIN entity_shares/)
    expect(list.params).toEqual([USER, [3]])
    const [payments] = statements(queries, /FROM debt_payments/)
    expect(payments.sql).not.toContain('user_id')
    expect(payments.params).toEqual([[9]])
  })
})

describe('DELETE /debts/:id', () => {
  const owned = { id: 9, name: 'Loan', amount: '100.000000000000', currency: 'USD', type: 'lend', account_id: 3 }
  const lockOwned = (debt = owned) => ({ match: /FROM debts WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: () => [debt] })
  const booking = (overrides = {}) => ({
    id: 70, account_id: 3, user_id: USER, amount: '100.000000000000', type: 'expense', is_split: false, account_currency: 'USD', ...overrides
  })
  const paymentTx = (overrides = {}) => ({
    payment_id: 1, id: 71, account_id: 3, user_id: USER, amount: '40.000000000000', type: 'income', untouched: true, ...overrides
  })

  it('removes only the owner\'s share rows, after the owned delete', async () => {
    const { app, queries } = buildServer([lockOwned({ ...owned, account_id: null })])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, reversed_transactions: [], kept_transactions: [] })
    const order = queries.map(q => q.sql).filter(sql => /^(BEGIN|COMMIT|DELETE)/.test(sql))
    expect(order[0]).toBe('BEGIN')
    expect(order[1]).toMatch(/^DELETE FROM debts/)
    expect(order[2]).toMatch(/^DELETE FROM entity_shares .*owner_id = \$2/)
    expect(order[3]).toBe('COMMIT')
    expect(statements(queries, /DELETE FROM entity_shares/)[0].params).toEqual([9, USER])
  })

  it('leaves other users\' shares alone when the debt is not the caller\'s', async () => {
    const { app, queries } = buildServer()
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(404)
    expect(statements(queries, /entity_shares/)).toHaveLength(0)
    expect(statements(queries, /DELETE FROM transactions|UPDATE accounts/)).toHaveLength(0)
  })

  it('reverses the creation booking and the payment transactions with their balance effect', async () => {
    const { app, queries } = buildServer([
      lockOwned(),
      { match: /FROM transactions t\s+JOIN debts d/, rows: () => [booking()] },
      { match: /SELECT id FROM debt_payments/, rows: () => [{ id: 1 }] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx()] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, reversed_transactions: [70, 71], kept_transactions: [] })
    expect(statements(queries, /DELETE FROM transactions/).map(q => q.params)).toEqual([[70], [71]])
    // the lend booking (-100) and the repayment (+40) are taken off the account
    const balances = statements(queries, /UPDATE accounts SET balance = balance - \$1/)
    expect(balances.map(q => q.params)).toEqual([['-100', 3, USER], ['40', 3, USER]])
    // all of it before the debt row goes, inside the one transaction
    const order = queries.map(q => q.sql)
    expect(order.findIndex(sql => sql.startsWith('DELETE FROM transactions'))).toBeLessThan(order.findIndex(sql => sql.startsWith('DELETE FROM debts')))
    expect(order.at(-1)).toBe('COMMIT')
  })

  it('keeps a booking whose amount was edited by hand and a payment transaction rewritten by hand', async () => {
    const { app, queries } = buildServer([
      lockOwned(),
      { match: /FROM transactions t\s+JOIN debts d/, rows: () => [booking({ amount: '90' })] },
      { match: /SELECT id FROM debt_payments/, rows: () => [{ id: 1 }] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx({ untouched: false })] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, reversed_transactions: [], kept_transactions: [70, 71] })
    expect(statements(queries, /DELETE FROM transactions|UPDATE accounts/)).toHaveLength(0)
    expect(statements(queries, /DELETE FROM debts/)).toHaveLength(1)
  })

  it('keeps a payment transaction on an account the owner may not write', async () => {
    const { app, queries } = buildServer([
      lockOwned({ ...owned, account_id: null }),
      { match: /SELECT id FROM debt_payments/, rows: () => [{ id: 1 }] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx({ account_id: 8, user_id: 2 })] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json().kept_transactions).toEqual([71])
    expect(statements(queries, /DELETE FROM transactions|UPDATE accounts/)).toHaveLength(0)
  })
})

describe('bookingEditedByHand', () => {
  const debt = { amount: '100.000000000000', currency: 'USD', type: 'lend' }
  const booking = { amount: '100', type: 'expense', is_split: false, account_currency: 'USD' }
  it('accepts the booking as PUT /debts keeps it', () => {
    expect(bookingEditedByHand(booking, debt)).toBe(false)
  })
  it('flags a changed amount, type or a split', () => {
    expect(bookingEditedByHand({ ...booking, amount: '99.99' }, debt)).toBe(true)
    expect(bookingEditedByHand({ ...booking, type: 'income' }, debt)).toBe(true)
    expect(bookingEditedByHand({ ...booking, is_split: true }, debt)).toBe(true)
  })
  it('cannot check the amount of a booking in another currency', () => {
    expect(bookingEditedByHand({ ...booking, amount: '0.002', account_currency: 'BTC' }, debt)).toBe(false)
  })
})
