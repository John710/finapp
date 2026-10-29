import { describe, it, expect } from 'vitest'
import debtRoutes from '../routes/debts.js'
import { buildStubServer, pgError, TEST_USER as USER } from './helpers/stub-db.js'

const OWNER = 1

function lockedDebt(overrides = {}) {
  return {
    id: 9, amount: '100.000000000000', currency: 'USD', type: 'lend', name: 'Loan', status: 'active',
    account_id: 3, owner_id: USER, access: 'edit', ...overrides
  }
}

function installment(overrides = {}) {
  return {
    id: 21, debt_id: 9, user_id: USER, position: 2, due_date: '2026-02-15', amount: '33.330000000000',
    status: 'due', paid_on: null, note: null, ...overrides
  }
}

function account(overrides = {}) {
  return { id: 3, owner_id: USER, currency: 'USD', type: 'checking', access: 'own', ...overrides }
}

// The lookups every installment action makes, answered for one installment.
function installmentHandlers({ debt = lockedDebt(), inst = installment() } = {}) {
  return [
    { match: /SELECT debt_id FROM debt_installments WHERE id = \$1/, rows: () => (inst ? [{ debt_id: inst.debt_id }] : []) },
    { match: /FROM debts d WHERE d\.id = \$1/, rows: () => (debt ? [debt] : []) },
    { match: /FROM debt_installments i WHERE i\.id = \$1 AND i\.debt_id = \$2/, rows: () => (inst ? [inst] : []) }
  ]
}

function buildServer(handlers = []) {
  return buildStubServer(debtRoutes, [
    ...handlers,
    { match: /FROM exchange_rates/, rows: () => [{ from_currency: 'EUR', to_currency: 'USD', rate: '2' }] },
    { match: /FROM categories/, rows: () => [{ id: 50 }] }
  ])
}

const statements = (queries, re) => queries.filter(q => re.test(q.sql))
const writes = queries => queries.filter(q => /^(INSERT|UPDATE|DELETE)/.test(q.sql))

describe('GET /debts installments', () => {
  it('attaches each debt\'s schedule from one query, without the owner column', async () => {
    const { app, queries } = buildServer([
      { match: /UNION/, rows: () => [{ id: 3 }] },
      { match: /FROM debts d/, rows: () => [{ id: 9, amount: '100', currency: 'USD', user_id: USER }, { id: 10, amount: '5', currency: 'USD', user_id: USER }] },
      { match: /FROM debt_installments i WHERE i\.debt_id = ANY/, rows: () => [installment({ position: 1 })] }
    ])
    const res = await app.inject({ method: 'GET', url: '/debts' })
    expect(res.statusCode).toBe(200)
    const [first, second] = res.json()
    expect(first.installments).toEqual([
      { id: 21, position: 1, due_date: '2026-02-15', amount: '33.330000000000', status: 'due', paid_on: null, note: null }
    ])
    expect(second.installments).toEqual([])
    const [list] = statements(queries, /FROM debt_installments/)
    expect(list.sql).toContain('i.due_date::text AS due_date')
    expect(list.params).toEqual([[9, 10]])
  })
})

describe('PUT /debts/:id/installments', () => {
  const lock = (debt = lockedDebt()) => ({ match: /FROM debts d WHERE d\.id = \$1/, rows: () => [debt] })

  it('replaces the schedule with an exact equal split at the currency precision', async () => {
    const { app, queries } = buildServer([
      lock(),
      { match: /INSERT INTO debt_installments/, rows: () => [{ id: 1 }, { id: 2 }, { id: 3 }] },
      { match: /WHERE i\.id = ANY/, rows: () => [installment({ id: 1 })] }
    ])
    const res = await app.inject({
      method: 'PUT', url: '/debts/9/installments',
      payload: { split: { count: 3, start_date: '2026-01-31', unit: 'month' } }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().debt_id).toBe(9)
    const order = writes(queries).map(q => q.sql.slice(0, 30))
    expect(order).toEqual(['DELETE FROM debt_installments ', 'INSERT INTO debt_installments '])
    const [insert] = statements(queries, /INSERT INTO debt_installments/)
    expect(insert.params).toEqual([
      9, USER, [1, 2, 3], ['2026-01-31', '2026-02-28', '2026-03-31'], ['33.33', '33.33', '33.34']
    ])
  })

  it('stores the rows under the debt owner when a family member edits the schedule', async () => {
    const { app, queries } = buildServer([lock(lockedDebt({ owner_id: OWNER }))])
    const res = await app.inject({
      method: 'PUT', url: '/debts/9/installments',
      payload: { rows: [{ due_date: '2026-03-01', amount: '60' }, { due_date: '2026-02-01', amount: 40 }] }
    })
    expect(res.statusCode).toBe(200)
    const [insert] = statements(queries, /INSERT INTO debt_installments/)
    expect(insert.params).toEqual([9, OWNER, [1, 2], ['2026-02-01', '2026-03-01'], ['40', '60']])
  })

  it('answers 422 installments_sum_mismatch when the rows miss the debt by a cent', async () => {
    const { app, queries } = buildServer([lock()])
    const res = await app.inject({
      method: 'PUT', url: '/debts/9/installments',
      payload: { rows: [{ due_date: '2026-02-01', amount: '50' }, { due_date: '2026-03-01', amount: '49.99' }] }
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: 'installments_sum_mismatch' })
    expect(res.json().error).toContain('99.99')
    expect(writes(queries)).toHaveLength(0)
    expect(queries.at(-1).sql).toBe('ROLLBACK')
  })

  it('answers 409 installments_locked once part of the schedule is paid or skipped', async () => {
    const { app, queries } = buildServer([
      lock(),
      { match: /status <> 'due'/, rows: () => [{ '?column?': 1 }] }
    ])
    const res = await app.inject({
      method: 'PUT', url: '/debts/9/installments',
      payload: { rows: [{ due_date: '2026-02-01', amount: '100' }] }
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('installments_locked')
    expect(writes(queries)).toHaveLength(0)
  })

  it('removes the schedule with an empty list', async () => {
    const { app, queries } = buildServer([lock()])
    const res = await app.inject({ method: 'PUT', url: '/debts/9/installments', payload: { rows: [] } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ debt_id: 9, installments: [] })
    expect(writes(queries).map(q => q.sql.slice(0, 29))).toEqual(['DELETE FROM debt_installments'])
  })

  it('answers 400 on two rows for one date and on a split that rounds to nothing', async () => {
    const { app } = buildServer([lock(lockedDebt({ amount: '0.020000000000' }))])
    const dup = await app.inject({
      method: 'PUT', url: '/debts/9/installments',
      payload: { rows: [{ due_date: '2026-02-01', amount: '0.01' }, { due_date: '2026-02-01', amount: '0.01' }] }
    })
    expect(dup.statusCode).toBe(400)
    expect(dup.json().code).toBe('installment_duplicate_date')
    const tiny = await app.inject({
      method: 'PUT', url: '/debts/9/installments', payload: { split: { count: 3, start_date: '2026-01-01' } }
    })
    expect(tiny.statusCode).toBe(400)
    expect(tiny.json().code).toBe('installments_too_small')
  })

  it('answers 403 to a view-only share and 404 to a stranger', async () => {
    const view = buildServer([lock(lockedDebt({ owner_id: OWNER, access: 'view' }))])
    const res = await view.app.inject({ method: 'PUT', url: '/debts/9/installments', payload: { rows: [] } })
    expect(res.statusCode).toBe(403)
    expect(writes(view.queries)).toHaveLength(0)

    const none = buildServer([lock(lockedDebt({ owner_id: OWNER, access: 'none' }))])
    expect((await none.app.inject({ method: 'PUT', url: '/debts/9/installments', payload: { rows: [] } })).statusCode).toBe(404)
  })

  it('rejects a body with both rows and split', async () => {
    const { app } = buildServer([lock()])
    const res = await app.inject({
      method: 'PUT', url: '/debts/9/installments',
      payload: { rows: [], split: { count: 2, start_date: '2026-01-01' } }
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /debts/installments/:id/pay', () => {
  it('records the installment amount as a payment linked to it and books it on the debt\'s account', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [account()] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 5, installment_id: 21 }] },
      { match: /INSERT INTO transactions/, rows: () => [{ id: 80 }] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '33.33', currency: 'USD' }] },
      { match: /UPDATE debt_installments i SET status = 'paid'/, rows: () => [installment({ status: 'paid', paid_on: '2026-02-15' })] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/pay', payload: {} })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      installment: installment({ status: 'paid', paid_on: '2026-02-15' }),
      payment: { id: 5, installment_id: 21 },
      transaction: { id: 80 }
    })
    const [payment] = statements(queries, /INSERT INTO debt_payments/)
    expect(payment.params).toEqual([USER, 9, '33.33', 'USD', null, 3, USER, 21])
    const [tx] = statements(queries, /INSERT INTO transactions/)
    expect(tx.params).toEqual([USER, 3, 50, '33.33', 'income', 'debt_payment:Loan', USER])
    // the last installment alone does not close the debt: payments do
    expect(statements(queries, /UPDATE debts SET status/)).toHaveLength(0)
    expect(queries.at(-1).sql).toBe('COMMIT')
  })

  it('records without a transaction when account_id is null, and converts into another currency', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers({ inst: installment({ amount: '40' }) }),
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 5 }] },
      { match: /UPDATE debt_installments i SET status = 'paid'/, rows: () => [installment({ status: 'paid' })] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/pay', payload: { account_id: null, currency: 'EUR' } })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction).toBe(null)
    const [payment] = statements(queries, /INSERT INTO debt_payments/)
    // 40 USD at 2 USD/EUR
    expect(payment.params.slice(2, 6)).toEqual(['20', 'EUR', null, null])
    expect(statements(queries, /INSERT INTO transactions|UPDATE accounts/)).toHaveLength(0)
  })

  it('accepts a request without a body', async () => {
    const { app } = buildServer([
      ...installmentHandlers({ debt: lockedDebt({ account_id: null }) }),
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 5 }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/pay' })
    expect(res.statusCode).toBe(201)
  })

  it('answers 409 already_paid and writes nothing', async () => {
    const { app, queries } = buildServer(installmentHandlers({ inst: installment({ status: 'paid' }) }))
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/pay', payload: {} })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('already_paid')
    expect(writes(queries)).toHaveLength(0)
  })

  it('answers 400 when the account has no rate for the debt currency', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [account({ currency: 'XMR' })] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/pay', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('exchange_rate_missing')
    expect(writes(queries)).toHaveLength(0)
  })

  it('answers 403 to a view-only share and 404 to an unknown installment', async () => {
    const view = buildServer(installmentHandlers({ debt: lockedDebt({ owner_id: OWNER, access: 'view' }) }))
    expect((await view.app.inject({ method: 'POST', url: '/debts/installments/21/pay', payload: {} })).statusCode).toBe(403)
    const gone = buildServer(installmentHandlers({ inst: null }))
    const res = await gone.app.inject({ method: 'POST', url: '/debts/installments/21/pay', payload: {} })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('installment_not_found')
  })
})

describe('DELETE /debts/installments/:id/pay', () => {
  const paid = installment({ status: 'paid', paid_on: '2026-02-15' })
  const tx = (overrides = {}) => ({ payment_id: 5, id: 80, account_id: 3, user_id: USER, amount: '33.330000000000', type: 'income', untouched: true, ...overrides })

  it('reverses an untouched payment transaction, removes the payment and reopens the installment and the debt', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers({ debt: lockedDebt({ status: 'paid' }), inst: paid }),
      { match: /SELECT id, account_id FROM debt_payments/, rows: () => [{ id: 5, account_id: 3 }] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [tx()] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '66.66', currency: 'USD' }] },
      { match: /UPDATE debt_installments i SET status = 'due'/, rows: () => [installment()] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/installments/21/pay' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ installment: installment(), removed_payments: [5], reversed_transactions: [80] })
    expect(statements(queries, /DELETE FROM transactions/)[0].params).toEqual([80])
    expect(statements(queries, /UPDATE accounts SET balance = balance - \$1/)[0].params).toEqual(['33.33', 3, USER])
    expect(statements(queries, /DELETE FROM debt_payments/)[0].params).toEqual([[5]])
    expect(statements(queries, /UPDATE debts SET status = 'active'/)[0].params).toEqual([9])
    const [find] = statements(queries, /FROM debt_payments p\s+JOIN transactions t/)
    expect(find.sql).toContain("starts_with(t.note, 'debt_payment:')")
    expect(find.sql).toContain('t.created_at = p.created_at')
  })

  it('answers 409 payment_edited when the transaction was rewritten by hand', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers({ inst: paid }),
      { match: /SELECT id, account_id FROM debt_payments/, rows: () => [{ id: 5, account_id: 3 }] },
      { match: /FROM debt_payments p\s+JOIN transactions t/, rows: () => [tx({ untouched: false })] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/installments/21/pay' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('payment_edited')
    expect(writes(queries)).toHaveLength(0)
    expect(queries.at(-1).sql).toBe('ROLLBACK')
  })

  it('answers 409 payment_edited when the transaction is gone or was moved', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers({ inst: paid }),
      { match: /SELECT id, account_id FROM debt_payments/, rows: () => [{ id: 5, account_id: 3 }] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/installments/21/pay' })
    expect(res.statusCode).toBe(409)
    expect(writes(queries)).toHaveLength(0)
  })

  it('removes a payment that never had an account without touching any balance', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers({ inst: paid }),
      { match: /SELECT id, account_id FROM debt_payments/, rows: () => [{ id: 5, account_id: null }] },
      { match: /UPDATE debt_installments i SET status = 'due'/, rows: () => [installment()] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/installments/21/pay' })
    expect(res.statusCode).toBe(200)
    expect(statements(queries, /JOIN transactions|UPDATE accounts|DELETE FROM transactions|UPDATE debts/)).toHaveLength(0)
  })

  it('answers 409 installment_not_paid for a due installment', async () => {
    const { app } = buildServer(installmentHandlers())
    const res = await app.inject({ method: 'DELETE', url: '/debts/installments/21/pay' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('installment_not_paid')
  })
})

describe('POST|DELETE /debts/installments/:id/skip', () => {
  it('skips a due installment without moving money', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /UPDATE debt_installments i SET status = \$1/, rows: () => [installment({ status: 'skipped' })] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/skip' })
    expect(res.statusCode).toBe(200)
    expect(res.json().installment.status).toBe('skipped')
    expect(writes(queries).map(q => q.params)).toEqual([['skipped', 21]])
  })

  it('un-skips back to due', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers({ inst: installment({ status: 'skipped' }) }),
      { match: /UPDATE debt_installments i SET status = \$1/, rows: () => [installment()] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/debts/installments/21/skip' })
    expect(res.statusCode).toBe(200)
    expect(writes(queries).map(q => q.params)).toEqual([['due', 21]])
  })

  it('refuses to skip a paid installment', async () => {
    const { app, queries } = buildServer(installmentHandlers({ inst: installment({ status: 'paid' }) }))
    const res = await app.inject({ method: 'POST', url: '/debts/installments/21/skip' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('already_paid')
    expect(writes(queries)).toHaveLength(0)
  })
})

describe('PATCH /debts/installments/:id', () => {
  it('moves the date and renumbers the positions in two steps', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /SELECT .* FROM debt_installments i WHERE i\.id = \$1$/, rows: () => [installment({ due_date: '2026-04-01', position: 3 })] }
    ])
    const res = await app.inject({ method: 'PATCH', url: '/debts/installments/21', payload: { due_date: '2026-04-01', note: 'later' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().installment.due_date).toBe('2026-04-01')
    const w = writes(queries)
    expect(w[0].sql).toMatch(/^UPDATE debt_installments SET due_date = \$1::date, note = \$2, updated_at = now\(\) WHERE id = \$3$/)
    expect(w[0].params).toEqual(['2026-04-01', 'later', 21])
    expect(w[1].sql).toContain('position = -position')
    expect(w[2].sql).toContain('ROW_NUMBER() OVER (ORDER BY due_date, id)')
  })

  it('accepts an amount that keeps the schedule equal to the debt', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /SELECT amount FROM debt_installments/, rows: () => [{ amount: '33.330000000000' }, { amount: '33.340000000000' }] }
    ])
    const res = await app.inject({ method: 'PATCH', url: '/debts/installments/21', payload: { amount: '33.33' } })
    expect(res.statusCode).toBe(200)
    expect(writes(queries)[0].params).toEqual(['33.33', 21])
    // no date change: positions stay
    expect(statements(queries, /position = -position/)).toHaveLength(0)
  })

  it('answers 422 when a new amount breaks the sum', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /SELECT amount FROM debt_installments/, rows: () => [{ amount: '33.33' }, { amount: '33.34' }] }
    ])
    const res = await app.inject({ method: 'PATCH', url: '/debts/installments/21', payload: { amount: 40 } })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('installments_sum_mismatch')
    expect(writes(queries)).toHaveLength(0)
  })

  it('answers 409 for an installment that is no longer due', async () => {
    const { app } = buildServer(installmentHandlers({ inst: installment({ status: 'skipped' }) }))
    const res = await app.inject({ method: 'PATCH', url: '/debts/installments/21', payload: { note: 'x' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('installment_not_due')
  })

  it('answers 409 installment_date_taken when another installment holds the date', async () => {
    const { app, queries } = buildServer([
      ...installmentHandlers(),
      { match: /^UPDATE debt_installments SET due_date/, throws: () => pgError('23505', 'debt_installments_debt_id_due_date_key') }
    ])
    const res = await app.inject({ method: 'PATCH', url: '/debts/installments/21', payload: { due_date: '2026-03-15' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('installment_date_taken')
    expect(statements(queries, /^ROLLBACK$/)).toHaveLength(1)
    expect(statements(queries, /^COMMIT$/)).toHaveLength(0)
  })

  it('rejects an empty patch', async () => {
    const { app } = buildServer(installmentHandlers())
    const res = await app.inject({ method: 'PATCH', url: '/debts/installments/21', payload: {} })
    expect(res.statusCode).toBe(400)
  })
})
