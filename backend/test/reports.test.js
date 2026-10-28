import { describe, it, expect } from 'vitest'
import reportRoutes from '../routes/reports.js'
import exportRoutes from '../routes/export.js'
import { buildStubServer } from './helpers/stub-db.js'

// Report aggregation on stubbed SQL groups. The groups carry the flow type the
// SQL computes: the incoming leg of a transfer arrives as 'transfer_in'.

function reportServer(groups) {
  return buildStubServer(reportRoutes, [
    { match: /UNION/, rows: () => [{ id: 1 }, { id: 2 }] },
    { match: /FROM exchange_rates/, rows: () => [] },
    { match: /FROM accounts WHERE id = ANY/, rows: () => [{ balance: '1000', currency: 'USD' }] },
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
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

describe('GET /export/csv', () => {
  it('joins the global categories without a user_id predicate and exports text dates', async () => {
    const { app, queries } = buildStubServer(exportRoutes, [
      { match: /FROM transactions t/, rows: () => [{ date: '2026-03-01', account_name: 'Cash', type: 'expense', category_name: '=SUM(A1)', amount: '5.000000000000', currency: 'USD', note: null }] }
    ])
    const res = await app.inject({ method: 'GET', url: '/export/csv' })
    expect(res.statusCode).toBe(200)
    const [q] = queries
    expect(q.sql).not.toContain('c.user_id')
    expect(q.sql).toContain('t.date::text AS date')
    expect(res.body).toContain('2026-03-01;Cash;expense;\'=SUM(A1)')
  })
})
