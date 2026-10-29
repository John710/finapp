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

  it('keeps auto_paid only while the status stays as it was', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: () => [stored] },
      { match: /UPDATE debts/, rows: () => [stored] }
    ])
    await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, status: 'paid' } })
    const [update] = statements(queries, /UPDATE debts/)
    expect(update.sql).toContain('status = COALESCE($8, status), auto_paid = (auto_paid AND COALESCE($8, status) = status)')
    expect(update.params[7]).toBe('paid')
  })

  describe('with an installment schedule', () => {
    const lockStored = { match: /FROM debts WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: () => [stored] }
    const counts = (total, settled = 0) => ({ match: /AS settled\s+FROM debt_installments/, rows: () => [{ total, settled }] })
    const rows150 = [{ due_date: '2026-03-01', amount: '75' }, { due_date: '2026-02-01', amount: 75 }]
    const ledgerAndDebt = /UPDATE debts|UPDATE accounts|UPDATE transactions|INSERT INTO|DELETE FROM/

    it('answers 409 installments_need_update when the amount changes and no new schedule is sent', async () => {
      const { app, queries } = buildServer([lockStored, counts(3)])
      const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150 } })
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('installments_need_update')
      expect(res.json().error).toBeTruthy()
      expect(statements(queries, ledgerAndDebt)).toHaveLength(0)
      expect(queries.at(-1).sql).toBe('ROLLBACK')
    })

    it('answers 409 installments_need_update when only the currency changes', async () => {
      const { app } = buildServer([lockStored, counts(2)])
      const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, currency: 'EUR' } })
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('installments_need_update')
    })

    it('answers 409 installments_locked once an installment is paid or skipped, schedule sent or not', async () => {
      const without = buildServer([lockStored, counts(3, 1)])
      const res = await without.app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150 } })
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('installments_locked')
      expect(statements(without.queries, ledgerAndDebt)).toHaveLength(0)

      const withRows = buildServer([lockStored, counts(3, 1)])
      const res2 = await withRows.app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150, installments: { rows: rows150 } } })
      expect(res2.statusCode).toBe(409)
      expect(res2.json().code).toBe('installments_locked')
      expect(statements(withRows.queries, ledgerAndDebt)).toHaveLength(0)
    })

    it('answers 422 when the new schedule does not add up to the new amount', async () => {
      const { app, queries } = buildServer([lockStored, counts(2)])
      const res = await app.inject({
        method: 'PUT', url: '/debts/9',
        payload: { ...body, amount: 150, installments: { rows: [{ due_date: '2026-02-01', amount: '100' }] } }
      })
      expect(res.statusCode).toBe(422)
      expect(res.json().code).toBe('installments_sum_mismatch')
      expect(res.json().error).toContain('150')
      expect(statements(queries, ledgerAndDebt)).toHaveLength(0)
    })

    it('answers 400 on an invalid schedule row', async () => {
      const { app } = buildServer([lockStored])
      const res = await app.inject({
        method: 'PUT', url: '/debts/9',
        payload: { ...body, installments: { rows: [{ due_date: '2026-02-01', amount: '-5' }] } }
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().code).toBe('installments_invalid')
    })

    it('changes the amount and replaces the schedule in the same transaction', async () => {
      const reread = [
        { id: 31, debt_id: 9, user_id: USER, position: 1, due_date: '2026-02-01', amount: '75.000000000000', status: 'due', paid_on: null, note: null },
        { id: 32, debt_id: 9, user_id: USER, position: 2, due_date: '2026-03-01', amount: '75.000000000000', status: 'due', paid_on: null, note: null }
      ]
      const { app, queries } = buildServer([
        lockStored,
        counts(3),
        { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [ownAccount()] },
        { match: /UPDATE debts/, rows: () => [{ ...stored, amount: '150.000000000000' }] },
        { match: /INSERT INTO debt_installments/, rows: () => [{ id: 31 }, { id: 32 }] },
        { match: /WHERE i\.id = ANY/, rows: () => reread }
      ])
      const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150, installments: { rows: rows150 } } })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ...stored, amount: '150.000000000000', installments: reread })
      const order = queries.map(q => q.sql).filter(sql => /^(BEGIN|COMMIT|ROLLBACK|UPDATE debts|DELETE FROM debt_installments|INSERT INTO debt_installments)/.test(sql))
      expect(order.map(sql => sql.slice(0, 29))).toEqual([
        'BEGIN', 'UPDATE debts SET name = $1, c', 'DELETE FROM debt_installments', 'INSERT INTO debt_installments', 'COMMIT'
      ])
      const [insert] = statements(queries, /INSERT INTO debt_installments/)
      expect(insert.params).toEqual([9, USER, [1, 2], ['2026-02-01', '2026-03-01'], ['75', '75']])
    })

    it('removes the schedule with an empty list while changing the amount', async () => {
      const { app, queries } = buildServer([
        lockStored,
        counts(3),
        { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [ownAccount()] },
        { match: /UPDATE debts/, rows: () => [stored] }
      ])
      const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, amount: 150, installments: { rows: [] } } })
      expect(res.statusCode).toBe(200)
      expect(res.json().installments).toEqual([])
      expect(statements(queries, /debt_installments/).map(q => q.sql.slice(0, 29))).toEqual([
        'SELECT COUNT(*)::int AS total', 'DELETE FROM debt_installments'
      ])
    })

    it('does not look at the schedule when neither amount nor currency changes', async () => {
      const { app, queries } = buildServer([lockStored, { match: /UPDATE debts/, rows: () => [stored] }])
      const res = await app.inject({ method: 'PUT', url: '/debts/9', payload: { ...body, name: 'Renamed', amount: 100.0 } })
      expect(res.statusCode).toBe(200)
      expect(res.json().installments).toBeUndefined()
      expect(statements(queries, /debt_installments/)).toHaveLength(0)
    })
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
  const payment = (overrides = {}) => ({ id: 1, amount: '40.000000000000', currency: 'USD', ...overrides })

  it('removes only the owner\'s share rows, after the owned delete', async () => {
    const { app, queries } = buildServer([lockOwned({ ...owned, account_id: null })])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, reversed_transactions: [], kept_transactions: [], unmatched_payments: [] })
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
      { match: /SELECT id, amount::text AS amount, currency FROM debt_payments/, rows: () => [payment()] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx()] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, reversed_transactions: [70, 71], kept_transactions: [], unmatched_payments: [] })
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
      { match: /SELECT id, amount::text AS amount, currency FROM debt_payments/, rows: () => [payment()] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx({ untouched: false })] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, reversed_transactions: [], kept_transactions: [70, 71], unmatched_payments: [] })
    expect(statements(queries, /DELETE FROM transactions|UPDATE accounts/)).toHaveLength(0)
    expect(statements(queries, /DELETE FROM debts/)).toHaveLength(1)
  })

  it('keeps a payment transaction on an account the owner may not write', async () => {
    const { app, queries } = buildServer([
      lockOwned({ ...owned, account_id: null }),
      { match: /SELECT id, amount::text AS amount, currency FROM debt_payments/, rows: () => [payment()] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx({ account_id: 8, user_id: 2 })] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json().kept_transactions).toEqual([71])
    expect(statements(queries, /DELETE FROM transactions|UPDATE accounts/)).toHaveLength(0)
  })

  it('reports booked payments whose transaction is gone instead of dropping them silently', async () => {
    const { app, queries } = buildServer([
      lockOwned({ ...owned, account_id: null }),
      {
        match: /SELECT id, amount::text AS amount, currency FROM debt_payments/,
        rows: () => [payment(), payment({ id: 2, amount: '25.500000000000', currency: 'EUR' })]
      },
      // only payment 1 still has its transaction
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [paymentTx()] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      success: true,
      reversed_transactions: [71],
      kept_transactions: [],
      unmatched_payments: [{ id: 2, amount: '25.500000000000', currency: 'EUR' }]
    })
    // nothing is reversed for the unmatched payment
    expect(statements(queries, /DELETE FROM transactions/).map(q => q.params)).toEqual([[71]])
  })

  it('keeps a creation booking with a receipt attached', async () => {
    const { app, queries } = buildServer([
      lockOwned(),
      { match: /FROM transactions t\s+JOIN debts d/, rows: () => [booking({ has_attachments: true })] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/9' })
    expect(res.statusCode).toBe(200)
    expect(res.json().kept_transactions).toEqual([70])
    expect(statements(queries, /DELETE FROM transactions|UPDATE accounts/)).toHaveLength(0)
    const [find] = statements(queries, /FROM transactions t\s+JOIN debts d/)
    expect(find.sql).toContain('EXISTS (SELECT 1 FROM attachments x WHERE x.transaction_id = t.id) AS has_attachments')
  })

  it('counts a payment transaction with attachments as edited by hand', async () => {
    const { app, queries } = buildServer([
      lockOwned({ ...owned, account_id: null }),
      { match: /SELECT id, amount::text AS amount, currency FROM debt_payments/, rows: () => [payment()] }
    ])
    await app.inject({ method: 'DELETE', url: '/debts/9' })
    const [find] = statements(queries, /FROM debt_payments p\s+JOIN transactions t/)
    expect(find.sql).toContain('(t.updated_at = t.created_at AND NOT t.is_split AND NOT EXISTS (SELECT 1 FROM attachments x WHERE x.transaction_id = t.id)) AS untouched')
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
  it('flags a booking with a receipt attached', () => {
    expect(bookingEditedByHand({ ...booking, has_attachments: true }, debt)).toBe(true)
  })
  it('cannot check the amount of a booking in another currency', () => {
    expect(bookingEditedByHand({ ...booking, amount: '0.002', account_currency: 'BTC' }, debt)).toBe(false)
  })
})
