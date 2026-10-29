import { describe, it, expect } from 'vitest'
import reportRoutes from '../routes/reports.js'
import exportRoutes from '../routes/export.js'
import { buildStubServer } from './helpers/stub-db.js'

// Report aggregation on stubbed SQL groups. The groups carry the flow type the
// SQL computes: the incoming leg of a transfer arrives as 'transfer_in'.

function reportServer(groups, { today = '2026-03-05', accounts = [{ balance: '1000', currency: 'USD' }], rates = [] } = {}) {
  return buildStubServer(reportRoutes, [
    { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today }] },
    { match: /UNION/, rows: () => [{ id: 1 }, { id: 2 }] },
    { match: /FROM exchange_rates/, rows: () => rates },
    { match: /FROM accounts WHERE id = ANY/, rows: () => accounts },
    { match: /FROM transactions t/, rows: () => groups }
  ])
}

async function get(app, url) {
  const res = await app.inject({ method: 'GET', url })
  expect(res.statusCode).toBe(200)
  return res.json()
}

describe('transfer legs in reports', () => {
  it('keeps the incoming leg out of income, the count and the savings rate', async () => {
    const groups = [
      { type: 'income', account_currency: 'USD', account_type: 'checking', sum: '1000', count: 2 },
      { type: 'expense', account_currency: 'USD', account_type: 'checking', sum: '400', count: 3 },
      { type: 'transfer', account_currency: 'USD', account_type: 'checking', sum: '500', count: 1 },
      { type: 'transfer_in', account_currency: 'USD', account_type: 'savings', sum: '500', count: 1 }
    ]
    const { app, queries } = reportServer(groups)
    const summary = await get(app, '/reports/summary')
    expect(summary).toMatchObject({ total_income: 1000, total_expense: 400, total_transfer: 500, net: 600, count: 6 })
    expect(queries.find(q => /FROM transactions t/.test(q.sql)).sql).toContain("THEN 'transfer_in'")

    const savings = await get(reportServer(groups).app, '/reports/savings-rate')
    expect(savings).toMatchObject({ income: 1000, expense: 400, savings: 600, rate: 60 })
  })

  it('counts the incoming leg as an inflow when walking net worth back', async () => {
    const month = '2026-03'
    const { app } = reportServer([
      { month, type: 'transfer', account_currency: 'USD', sum: '300' },
      { month, type: 'transfer_in', account_currency: 'USD', sum: '300' }
    ])
    const series = await get(app, '/reports/net-worth?months=1')
    expect(series).toEqual([{ month, change: 0, balance: 1000 }])
  })

  it('leaves the incoming leg out of the trend income', async () => {
    const { app } = reportServer([
      { month: '2026-03', type: 'income', account_currency: 'USD', sum: '100' },
      { month: '2026-03', type: 'transfer_in', account_currency: 'USD', sum: '900' }
    ])
    const trend = await get(app, '/reports/trend')
    expect(trend).toEqual([{ month: '2026-03', income: 100, expense: 0, transfer: 0, net: 100 }])
  })
})

describe('GET /reports/by-category', () => {
  it('keeps income and expense of one category apart, each share of its own type', async () => {
    const { app, queries } = reportServer([
      { category_id: 5, category_name: 'Freelance', category_color: '#111', type: 'income', account_currency: 'USD', sum: '300', count: 1 },
      { category_id: 6, category_name: 'Salary', category_color: '#222', type: 'income', account_currency: 'USD', sum: '700', count: 1 },
      { category_id: 5, category_name: 'Freelance', category_color: '#111', type: 'expense', account_currency: 'USD', sum: '50', count: 2 },
      { category_id: null, category_name: null, category_color: null, type: 'expense', account_currency: 'USD', sum: '150', count: 1 },
      { category_id: null, category_name: null, category_color: null, type: 'transfer_in', account_currency: 'USD', sum: '999', count: 1 }
    ])
    const rows = await get(app, '/reports/by-category')
    const pick = (type, id) => rows.find(r => r.type === type && r.id === id)
    expect(rows).toHaveLength(4)
    expect(pick('income', 5)).toMatchObject({ total: 300, percentage: 30, count: 1 })
    expect(pick('income', 6)).toMatchObject({ total: 700, percentage: 70 })
    expect(pick('expense', 5)).toMatchObject({ total: 50, percentage: 25, count: 2 })
    expect(pick('expense', null)).toMatchObject({ total: 150, percentage: 75, color: '#94a3b8' })
    expect(queries.find(q => /FROM transactions t/.test(q.sql)).sql).toContain("THEN 'transfer_in'")
  })
})

describe('report totals are exact until the response', () => {
  it('rounds trend totals and the net once, half-up, from the exact sums', async () => {
    // Through a float, 1.255 printed as 1.25 and 1.255 - 0.25 as 1.00
    const { app } = reportServer([
      { month: '2026-03', type: 'income', account_currency: 'USD', sum: '1.255000000000' },
      { month: '2026-03', type: 'expense', account_currency: 'USD', sum: '0.250000000000' }
    ])
    const trend = await get(app, '/reports/trend')
    expect(trend).toEqual([{ month: '2026-03', income: 1.26, expense: 0.25, transfer: 0, net: 1.01 }])
  })

  it('adds 0.1 and 0.2 from different currencies to exactly 0.3', async () => {
    const { app } = reportServer([
      { type: 'income', account_currency: 'USD', account_type: 'card', sum: '0.1', count: 1 },
      { type: 'income', account_currency: 'EUR', account_type: 'card', sum: '0.2', count: 1 }
    ], { rates: [{ from_currency: 'EUR', to_currency: 'USD', rate: '1' }] })
    const summary = await get(app, '/reports/summary')
    expect(summary).toMatchObject({ total_income: 0.3, net: 0.3, count: 2 })
  })

  it('keeps the half cent of the savings figures', async () => {
    // 1000 rows of 19.99 summed by PostgreSQL, plus a 100.005 income
    const { app } = reportServer([
      { type: 'income', account_currency: 'USD', account_type: 'card', sum: '20090.005000000000', count: 2 },
      { type: 'expense', account_currency: 'USD', account_type: 'card', sum: '19990.000000000000', count: 1000 }
    ])
    const savings = await get(app, '/reports/savings-rate')
    expect(savings).toMatchObject({ income: 20090.01, expense: 19990, savings: 100.01 })
  })

  it('does not round a crypto base currency to cents', async () => {
    const { app } = reportServer([
      { month: '2026-03', type: 'income', account_currency: 'BTC', sum: '0.000000010000' }
    ], { accounts: [{ balance: '0.000000010000', currency: 'BTC' }] })
    const series = await get(app, '/reports/net-worth?months=2&base_currency=BTC')
    expect(series).toEqual([
      { month: '2026-02', change: 0, balance: 0 },
      { month: '2026-03', change: 0.00000001, balance: 0.00000001 }
    ])

    const rows = await get(reportServer([
      { category_id: 1, category_name: 'Fees', category_color: '#111', type: 'expense', account_currency: 'BTC', sum: '0.000000010000', count: 1 },
      { category_id: 2, category_name: 'Gas', category_color: '#222', type: 'expense', account_currency: 'BTC', sum: '0.000000030000', count: 3 }
    ]).app, '/reports/by-category?base_currency=BTC')
    expect(rows.map(r => [r.id, r.total, r.percentage])).toEqual([[2, 0.00000003, 75], [1, 0.00000001, 25]])
  })

  it('orders categories by their exact totals, not the rounded ones', async () => {
    const { app } = reportServer([
      { category_id: 1, category_name: 'A', category_color: '#111', type: 'expense', account_currency: 'USD', sum: '10.001', count: 1 },
      { category_id: 2, category_name: 'B', category_color: '#222', type: 'expense', account_currency: 'USD', sum: '10.004', count: 1 }
    ])
    const rows = await get(app, '/reports/by-category')
    expect(rows.map(r => [r.id, r.total])).toEqual([[2, 10], [1, 10]])
  })
})

describe('GET /export/csv', () => {
  it('joins the global categories without a user_id predicate and exports text dates', async () => {
    const { app, queries } = buildStubServer(exportRoutes, [
      { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today: '2026-03-05' }] },
      { match: /FROM transactions t/, rows: () => [{ date: '2026-03-01', account_name: 'Cash', type: 'expense', category_name: '=SUM(A1)', amount: '5.000000000000', currency: 'USD', note: null }] }
    ])
    const res = await app.inject({ method: 'GET', url: '/export/csv' })
    expect(res.statusCode).toBe(200)
    // Named after the database day, not the UTC day of the Node clock
    expect(res.headers['content-disposition']).toBe('attachment; filename="finapp_export_2026-03-05.csv"')
    const q = queries.find(entry => /FROM transactions t/.test(entry.sql))
    expect(q.sql).not.toContain('c.user_id')
    expect(q.sql).toContain('t.date::text AS date')
    expect(res.body).toContain('2026-03-01;Cash;expense;\'=SUM(A1)')
  })
})
