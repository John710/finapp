import { describe, it, expect } from 'vitest'
import debtRoutes from '../routes/debts.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'
import { debtCovered } from '../services/debt-payments.js'

// Pins what POST /debts/:id/payments writes, statement by statement. The
// payment logic moved into services/debt-payments.js (recordDebtPayment) so
// the calendar's "pay installment" books exactly the same way; these cases
// passed against the inline route before the move and must keep passing.

const OWNER = 1

function lockedDebt(overrides = {}) {
  return { id: 9, amount: '100', currency: 'USD', type: 'lend', name: 'Loan', owner_id: USER, access: 'edit', ...overrides }
}

function account(overrides = {}) {
  return { id: 3, owner_id: USER, currency: 'USD', type: 'checking', access: 'own', ...overrides }
}

function buildServer(handlers = []) {
  return buildStubServer(debtRoutes, [
    ...handlers,
    { match: /FROM exchange_rates/, rows: () => [{ from_currency: 'EUR', to_currency: 'USD', rate: '2' }] },
    { match: /FROM categories/, rows: () => [{ id: 50 }] }
  ])
}

// Every write and transaction-control statement, with its bind values as the
// driver would send them (undefined goes out as NULL, numbers as text).
function writes(queries) {
  return queries
    .filter(q => /^(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE)/.test(q.sql))
    .map(q => {
      const head = q.sql.match(/^(BEGIN|COMMIT|ROLLBACK|INSERT INTO \w+|UPDATE \w+|DELETE FROM \w+)/)[1]
      return [head, q.params.map(p => (p === undefined || p === null ? null : String(p)))]
    })
}

describe('POST /debts/:id/payments ledger effects', () => {
  it('books a payment into an account, closes the debt, and notifies after COMMIT', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [lockedDebt()] },
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [account()] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 1, debt_id: 9, amount: '100' }] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '100', currency: 'USD' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 100, note: 'n', account_id: 3 } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ id: 1, debt_id: 9, amount: '100' })

    const w = writes(queries)
    expect(w.map(([head]) => head)).toEqual([
      'BEGIN',
      'INSERT INTO debt_payments',
      'INSERT INTO transactions',
      'UPDATE accounts',
      'UPDATE debts',
      'COMMIT',
      'INSERT INTO notifications'
    ])
    const [, payment, tx, balance, status] = w
    expect(payment[1].slice(0, 7)).toEqual([String(USER), '9', '100', 'USD', 'n', '3', String(USER)])
    expect(payment[1].slice(7).every(p => p === null)).toBe(true)
    expect(tx[1]).toEqual([String(USER), '3', '50', '100', 'income', 'debt_payment:Loan', String(USER)])
    expect(balance[1]).toEqual(['100', '3', String(USER)])
    expect(status[1]).toEqual(['paid', '9'])
    expect(w.at(-1)[1][0]).toBe(String(USER))
  })

  it('records a partial payment without an account: no transaction, no status, no notification', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [lockedDebt({ type: 'borrow' })] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 2 }] },
      // 30 EUR at 2 USD/EUR is 60 USD, still short of 100
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '30', currency: 'EUR' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 30, currency: 'EUR' } })
    expect(res.statusCode).toBe(201)
    const w = writes(queries)
    expect(w.map(([head]) => head)).toEqual(['BEGIN', 'INSERT INTO debt_payments', 'COMMIT'])
    expect(w[1][1].slice(0, 7)).toEqual([String(USER), '9', '30', 'EUR', null, null, String(USER)])
  })

  it('stores a family member\'s payment under the debt owner and books it on the member\'s account', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [lockedDebt({ owner_id: OWNER, type: 'borrow' })] },
      { match: /FROM accounts a WHERE a\.id = \$2/, rows: () => [account({ id: 4, currency: 'EUR' })] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 3 }] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '100', currency: 'USD' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 100, account_id: 4 } })
    expect(res.statusCode).toBe(201)
    const w = writes(queries)
    const payment = w.find(([head]) => head === 'INSERT INTO debt_payments')
    expect(payment[1].slice(0, 7)).toEqual([String(OWNER), '9', '100', 'USD', null, '4', String(USER)])
    // 100 USD at 2 USD/EUR is 50 EUR, paid out of the account (borrow → expense)
    const tx = w.find(([head]) => head === 'INSERT INTO transactions')
    expect(tx[1]).toEqual([String(USER), '4', '50', '50', 'expense', 'debt_payment:Loan', String(USER)])
    const balance = w.find(([head]) => head === 'UPDATE accounts')
    expect(balance[1]).toEqual(['-50', '4', String(USER)])
    // the debt is closed and its owner — not the payer — is notified
    expect(w.at(-1)).toEqual(['INSERT INTO notifications', [String(OWNER), 'debt_paid', expect.any(String), expect.any(String), expect.any(String)]])
  })

  it('closes the debt when a converted payment leaves it short only by dust, marking the status automatic', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [lockedDebt()] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 4 }] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '99.999999999999', currency: 'USD' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 99.999999999999 } })
    expect(res.statusCode).toBe(201)
    const [status] = queries.filter(q => /^UPDATE debts/.test(q.sql))
    expect(status.sql).toBe('UPDATE debts SET status = $1, auto_paid = (auto_paid OR status <> $1) WHERE id = $2')
    expect(status.params).toEqual(['paid', 9])
  })

  it('does not close the debt a whole cent short', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [lockedDebt()] },
      { match: /INSERT INTO debt_payments/, rows: () => [{ id: 4 }] },
      { match: /SELECT amount, currency FROM debt_payments/, rows: () => [{ amount: '99.99', currency: 'USD' }] }
    ])
    await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 99.99 } })
    expect(queries.filter(q => /^UPDATE debts/.test(q.sql))).toHaveLength(0)
  })

  it('answers 404 to a view-only share and writes nothing', async () => {
    const { app, queries } = buildServer([
      { match: /FROM debts d WHERE d\.id = \$1/, rows: () => [lockedDebt({ owner_id: OWNER, access: 'view' })] }
    ])
    const res = await app.inject({ method: 'POST', url: '/debts/9/payments', payload: { amount: 10 } })
    expect(res.statusCode).toBe(404)
    expect(writes(queries).map(([head]) => head)).toEqual(['BEGIN', 'ROLLBACK'])
  })
})

describe('debtCovered', () => {
  it('accepts a shortfall of up to half a minor unit of the debt currency', () => {
    expect(debtCovered('99.999999999999', '100', 'USD')).toBe(true)
    expect(debtCovered('99.995', '100', 'USD')).toBe(true)
    expect(debtCovered('99.994', '100', 'USD')).toBe(false)
    expect(debtCovered('100.5', '100', 'USD')).toBe(true)
  })

  it('uses the currency\'s own precision: whole yen, 8 decimals for crypto', () => {
    expect(debtCovered('9999.6', '10000', 'JPY')).toBe(true)
    expect(debtCovered('9999.4', '10000', 'JPY')).toBe(false)
    expect(debtCovered('0.999999996', '1', 'BTC')).toBe(true)
    expect(debtCovered('0.99999999', '1', 'BTC')).toBe(false)
  })

  it('falls back to USD precision for a debt without a currency', () => {
    expect(debtCovered('99.996', '100', null)).toBe(true)
  })
})
