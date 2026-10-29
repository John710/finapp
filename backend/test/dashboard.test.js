import { describe, it, expect } from 'vitest'
import dashboardRoutes from '../routes/dashboard.js'
import { shiftMonth } from '../services/recurring-schedule.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

// GET /reports/dashboard on a recording stub db. The handlers are matched in
// order, so the more specific transaction aggregations come first.

const placeholders = sql => new Set([...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))

function buildServer({
  today = '2026-03-05',
  visible = [1, 2],
  rates = [],
  month = [],
  trend = [],
  flows = [],
  accounts = [],
  debts = [],
  payments = []
} = {}) {
  return buildStubServer(dashboardRoutes, [
    { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today }] },
    { match: /UNION/, rows: () => visible.map(id => ({ id })) },
    { match: /FROM exchange_rates/, rows: () => rates },
    { match: /FROM recurring_rules/, rows: () => [] },
    { match: /to_char[\s\S]*t\.date >= \$2/, rows: () => trend },
    { match: /to_char/, rows: () => flows },
    { match: /SUM\(t\.amount\)/, rows: () => month },
    { match: /ORDER BY t\.date DESC/, rows: () => [] },
    { match: /FROM debt_payments/, rows: () => payments },
    { match: /FROM debts d/, rows: () => debts },
    { match: /FROM accounts a/, rows: () => accounts }
  ])
}

async function dashboard(app, url = '/reports/dashboard') {
  const res = await app.inject({ method: 'GET', url })
  expect(res.statusCode).toBe(200)
  return res.json()
}

describe('shiftMonth', () => {
  it('moves across year boundaries both ways', () => {
    expect(shiftMonth('2026-03', -5)).toBe('2025-10')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2025-12', 1)).toBe('2026-01')
    expect(shiftMonth('2026-03', 0)).toBe('2026-03')
    expect(shiftMonth('2026-03', -24)).toBe('2024-03')
  })
})

describe('GET /reports/dashboard', () => {
  it('binds the caller as its own parameter next to the visible-account array', async () => {
    const { app, queries } = buildServer()
    await dashboard(app)
    const recent = queries.find(q => /ORDER BY t\.date DESC/.test(q.sql))
    // $1 is the visible id array used with ANY; the user id must not share it
    expect(recent.sql).toContain('t.account_id = ANY($1)')
    expect(recent.sql).toContain('t.user_id = $3')
    expect(recent.sql).not.toContain('t.user_id = $1')
    expect(recent.params).toEqual([[1, 2], 5, USER])
    // Every statement binds exactly as many values as it has placeholders
    for (const q of queries) {
      expect(q.params.length).toBe(placeholders(q.sql).size)
    }
  })

  it('takes the month and trend windows from the database day, not the process clock', async () => {
    const { app, queries } = buildServer({ today: '2026-03-01' })
    await dashboard(app, '/reports/dashboard?trend_months=6')
    const month = queries.find(q => /SUM\(t\.amount\)/.test(q.sql) && !/to_char/.test(q.sql))
    expect(month.params).toEqual([[1, 2], '2026-03-01', '2026-03-01'])
    const trend = queries.find(q => /to_char[\s\S]*t\.date >= \$2/.test(q.sql))
    expect(trend.params).toEqual([[1, 2], '2025-10-01', '2026-03-01'])
  })

  it('lists net-worth months up to the database month', async () => {
    const { app } = buildServer({ today: '2026-01-31' })
    const body = await dashboard(app, '/reports/dashboard?networth_months=3')
    expect(body.net_worth.map(m => m.month)).toEqual(['2025-11', '2025-12', '2026-01'])
  })

  it('does not count the incoming leg of a transfer as income', async () => {
    const { app, queries } = buildServer({
      month: [
        { type: 'income', currency: 'USD', sum: '1000.000000000000' },
        { type: 'expense', currency: 'USD', sum: '300.000000000000' },
        { type: 'transfer', currency: 'USD', sum: '500.000000000000' },
        { type: 'transfer_in', currency: 'USD', sum: '500.000000000000' }
      ],
      trend: [
        { month: '2026-03', type: 'income', currency: 'USD', sum: '1000.000000000000' },
        { month: '2026-03', type: 'transfer_in', currency: 'USD', sum: '500.000000000000' }
      ]
    })
    const body = await dashboard(app)
    expect(body.month_summary).toEqual({ income: 1000, expense: 300, net: 700 })
    expect(body.trend[0].income).toBe(1000)
    const month = queries.find(q => /SUM\(t\.amount\)/.test(q.sql) && !/to_char/.test(q.sql))
    expect(month.sql).toContain("THEN 'transfer_in'")
  })

  it('walks net worth with transfer legs as inflows', async () => {
    const { app } = buildServer({
      today: '2026-03-05',
      accounts: [
        { id: 1, currency: 'USD', balance: '700.000000000000' },
        { id: 2, currency: 'USD', balance: '300.000000000000' }
      ],
      // March: 300 moved from account 1 to account 2 — net worth unchanged
      flows: [
        { month: '2026-03', type: 'transfer', currency: 'USD', sum: '300.000000000000' },
        { month: '2026-03', type: 'transfer_in', currency: 'USD', sum: '300.000000000000' }
      ]
    })
    const body = await dashboard(app, '/reports/dashboard?networth_months=2')
    expect(body.total_balance).toBe(1000)
    expect(body.net_worth).toEqual([
      { month: '2026-02', balance: 1000 },
      { month: '2026-03', balance: 1000 }
    ])
  })

  it('lists an account shared both to the family and to the user once', async () => {
    const { app, queries } = buildServer()
    await dashboard(app)
    const accounts = queries.find(q => /FROM accounts a/.test(q.sql) && /owner_login/.test(q.sql))
    expect(accounts.sql).toContain('LEFT JOIN LATERAL')
    expect(accounts.sql).toContain('LIMIT 1')
    const debts = queries.find(q => /FROM debts d/.test(q.sql))
    expect(debts.sql).not.toMatch(/LEFT JOIN entity_shares/)
    expect(debts.sql).toContain('EXISTS')
  })

  it('totals what is still owed on open debts, net of payments', async () => {
    const { app, queries } = buildServer({
      rates: [{ from_currency: 'USD', to_currency: 'EUR', rate: '0.5' }],
      debts: [
        { id: 10, amount: '1000.000000000000', currency: 'USD', type: 'borrow', status: 'active' },
        { id: 11, amount: '200.000000000000', currency: 'USD', type: 'lend', status: 'active' },
        { id: 12, amount: '999.000000000000', currency: 'USD', type: 'borrow', status: 'paid' }
      ],
      payments: [
        { debt_id: 10, amount: '400.000000000000', currency: 'USD' },
        // 50 EUR = 100 USD
        { debt_id: 10, amount: '50.000000000000', currency: 'EUR' },
        // overpaid: counts as nothing left, not a negative amount
        { debt_id: 11, amount: '250.000000000000', currency: 'USD' }
      ]
    })
    const body = await dashboard(app)
    expect(body.debts_summary).toEqual({ owed: 500, lent: 0, count: 2 })
    const payments = queries.find(q => /FROM debt_payments/.test(q.sql))
    expect(payments.params).toEqual([[10, 11]])
  })

  it('rounds the month, trend and balance totals once from the exact Decimal', async () => {
    // Through a float, 1.005 printed as 1.00 and 1.255 as 1.25
    const { app } = buildServer({
      rates: [{ from_currency: 'EUR', to_currency: 'USD', rate: '1' }],
      month: [
        { type: 'income', currency: 'USD', sum: '1.005000000000' },
        { type: 'expense', currency: 'USD', sum: '0.100000000000' },
        { type: 'expense', currency: 'EUR', sum: '0.200000000000' }
      ],
      trend: [{ month: '2026-03', type: 'income', currency: 'USD', sum: '1.255000000000' }],
      // 100 accounts of 19.99 and one of 0.005
      accounts: [...Array.from({ length: 100 }, (_, i) => ({ id: i + 1, currency: 'USD', balance: '19.990000000000' })),
        { id: 101, currency: 'USD', balance: '0.005000000000' }]
    })
    const body = await dashboard(app, '/reports/dashboard?networth_months=1')
    expect(body.month_summary).toEqual({ income: 1.01, expense: 0.3, net: 0.71 })
    expect(body.trend[0]).toEqual({ month: '2026-03', income: 1.26, expense: 0, transfer: 0 })
    expect(body.total_balance).toBe(1999.01)
    expect(body.net_worth).toEqual([{ month: '2026-03', balance: 1999.01 }])
  })

  it('keeps satoshis when the base currency is BTC', async () => {
    const { app } = buildServer({
      accounts: [{ id: 1, currency: 'BTC', balance: '0.000000010000' }],
      debts: [{ id: 10, amount: '0.000000020000', currency: 'BTC', type: 'lend', status: 'active' }]
    })
    const body = await dashboard(app, '/reports/dashboard?base_currency=BTC&networth_months=1')
    expect(body.total_balance).toBe(0.00000001)
    expect(body.net_worth).toEqual([{ month: '2026-03', balance: 0.00000001 }])
    expect(body.debts_summary).toEqual({ owed: 0, lent: 0.00000002, count: 1 })
  })
})
