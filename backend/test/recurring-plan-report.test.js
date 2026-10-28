import { describe, it, expect } from 'vitest'
import reportRoutes from '../routes/reports.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

// Contract of GET /reports/recurring-plan: for every calendar month in the range,
// the plan is what the active schedules ask for (skipped occurrences excluded) and
// the actual is what the ledger carries as recurring transactions.

function stubRule(overrides = {}) {
  return {
    id: 1,
    user_id: USER,
    account_id: 3,
    category_id: 5,
    amount: '100.000000000000',
    currency: 'USD',
    type: 'expense',
    frequency: 'monthly',
    interval_unit: 'month',
    interval_value: 1,
    billing_anchor_day: 5,
    start_date: '2026-01-05',
    next_date: '2026-03-05',
    end_date: null,
    cancellation_date: null,
    auto_renew: true,
    payment_limit: null,
    occurrences_paid: 0,
    last_run_date: null,
    notify_days_before: 0,
    note: 'Rent',
    is_active: true,
    account_name: 'Checking',
    category_name: 'Housing',
    owner_login: null,
    is_owner: true,
    is_shared: false,
    ...overrides
  }
}

function buildServer({ rules = [], paid = [], skipped = [], actual = [] } = {}) {
  return buildStubServer(reportRoutes, [
    { match: /FROM recurring_rules/, rows: () => rules },
    { match: /recurring_rule_id = ANY/, rows: () => paid.map(date => ({ rule_id: rules[0]?.id, date })) },
    { match: /FROM recurring_exceptions/, rows: () => skipped.map(date => ({ rule_id: rules[0]?.id, date })) },
    { match: /to_char\(t\.date, 'YYYY-MM'\)/, rows: () => actual }
  ])
}

describe('GET /reports/recurring-plan', () => {
  it('answers one row per calendar month in the range', async () => {
    const { app } = buildServer({ rules: [stubRule()] })
    const res = await app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-01-01&to=2026-03-31' })
    expect(res.statusCode).toBe(200)
    expect(res.json().months.map(m => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('plans the scheduled amount of every active rule in the month it falls', async () => {
    const { app } = buildServer({ rules: [stubRule(), stubRule({ id: 2, amount: '20.000000000000', note: 'Cleaning' })] })
    const res = await app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-01-01&to=2026-03-31' })
    const months = res.json().months
    expect(months.map(m => m.plan_expense)).toEqual([120, 120, 120])
    expect(months.every(m => m.plan_income === 0)).toBe(true)
  })

  it('excludes skipped occurrences and paused rules from the plan', async () => {
    const skippedServer = buildServer({ rules: [stubRule()], skipped: ['2026-02-05'] })
    const skippedRes = await skippedServer.app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-01-01&to=2026-03-31' })
    expect(skippedRes.json().months.map(m => m.plan_expense)).toEqual([100, 0, 100])

    const pausedServer = buildServer({ rules: [stubRule({ is_active: false })] })
    const pausedRes = await pausedServer.app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-01-01&to=2026-03-31' })
    expect(pausedRes.json().months.map(m => m.plan_expense)).toEqual([0, 0, 0])
  })

  it('counts income rules on the income side of the plan', async () => {
    const { app } = buildServer({ rules: [stubRule({ id: 7, type: 'income', amount: '2500.000000000000', note: 'Payday' })] })
    const res = await app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-01-01&to=2026-03-31' })
    const months = res.json().months
    expect(months.map(m => m.plan_income)).toEqual([2500, 2500, 2500])
    expect(months.every(m => m.plan_expense === 0)).toBe(true)
  })

  it('reads the actual side from recurring transactions grouped by month', async () => {
    const { app } = buildServer({
      rules: [stubRule()],
      actual: [
        { month: '2026-01', type: 'expense', account_currency: 'USD', sum: '100.000000000000' },
        { month: '2026-02', type: 'expense', account_currency: 'USD', sum: '95.000000000000' },
        { month: '2026-03', type: 'income', account_currency: 'USD', sum: '2500.000000000000' }
      ]
    })
    const res = await app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-01-01&to=2026-03-31' })
    const months = res.json().months
    expect(months.map(m => m.actual_expense)).toEqual([100, 95, 0])
    expect(months.map(m => m.actual_income)).toEqual([0, 0, 2500])
  })

  it('reports the paid amount of a rule as it was actually booked, not as planned', async () => {
    const { app } = buildServer({
      rules: [stubRule()],
      actual: [{ month: '2026-02', type: 'expense', account_currency: 'USD', sum: '130.000000000000' }]
    })
    const res = await app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-02-01&to=2026-02-28' })
    const [february] = res.json().months
    expect(february).toMatchObject({ month: '2026-02', plan_expense: 100, actual_expense: 130 })
  })

  it('rejects an inverted range', async () => {
    const { app } = buildServer({ rules: [stubRule()] })
    const res = await app.inject({ method: 'GET', url: '/reports/recurring-plan?from=2026-03-31&to=2026-01-01' })
    expect(res.statusCode).toBe(400)
  })
})
