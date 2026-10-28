import { describe, it, expect } from 'vitest'
import dashboardRoutes from '../routes/dashboard.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

// Contract of the recurring block of GET /reports/dashboard — the card the user
// sees without opening the Recurring page. Dates are the `::text` shapes pg
// returns for the rules read through ruleColumns(), so no process timezone
// decides which occurrence is upcoming.

const TODAY = '2026-03-05'

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
    billing_anchor_day: 31,
    start_date: '2026-01-31',
    next_date: '2026-03-31',
    end_date: null,
    cancellation_date: null,
    auto_renew: true,
    payment_limit: null,
    occurrences_paid: 0,
    last_run_date: null,
    notify_days_before: 0,
    note: 'Rent',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    account_name: 'Checking',
    category_name: 'Housing',
    owner_login: null,
    is_owner: true,
    is_shared: false,
    ...overrides
  }
}

function buildServer(rules, { paid = [], skipped = [] } = {}) {
  return buildStubServer(dashboardRoutes, [
    { match: /CURRENT_DATE/, rows: () => [{ today: TODAY }] },
    { match: /FROM recurring_rules/, rows: () => rules },
    {
      match: /FROM transactions WHERE recurring_rule_id/,
      rows: () => paid.map((date, i) => ({ rule_id: rules[Math.min(i, rules.length - 1)]?.id, date }))
    },
    {
      match: /FROM recurring_exceptions/,
      rows: () => skipped.map((date, i) => ({ rule_id: rules[Math.min(i, rules.length - 1)]?.id, date }))
    }
  ])
}

async function recurringBlock(handlers) {
  const res = await handlers.inject({ method: 'GET', url: '/reports/dashboard' })
  expect(res.statusCode).toBe(200)
  return res.json().recurring
}

describe('GET /reports/dashboard recurring block', () => {
  it('totals the monthly equivalent of the active rules only', async () => {
    const { app } = buildServer([
      // 100.00 monthly + 1200.00 yearly (100.00 per month) + a paused 500.00
      stubRule({ id: 1 }),
      stubRule({ id: 2, interval_unit: 'year', interval_value: 1, start_date: '2026-01-15', billing_anchor_day: 15, next_date: '2027-01-15', amount: '1200.000000000000', note: 'Insurance' }),
      stubRule({ id: 3, amount: '500.000000000000', is_active: false, note: 'Paused gym' })
    ])
    const recurring = await recurringBlock(app)
    expect(recurring.monthly_commitments).toBe(200)
    expect(recurring.active_count).toBe(2)
  })

  it('projects a weekly rule as 30.4375/7 of its amount', async () => {
    const { app } = buildServer([
      stubRule({ id: 4, interval_unit: 'week', interval_value: 1, start_date: '2026-03-02', billing_anchor_day: null, next_date: '2026-03-09', amount: '20.000000000000', note: 'Cleaning' })
    ])
    const recurring = await recurringBlock(app)
    expect(recurring.monthly_commitments).toBe(86.96)
  })

  it('lists upcoming occurrences from today, ordered by date and limited', async () => {
    const { app } = buildServer(
      [
        stubRule({ id: 4, interval_unit: 'week', interval_value: 1, start_date: '2026-03-02', billing_anchor_day: null, next_date: '2026-03-09', amount: '20.000000000000', note: 'Cleaning' }),
        stubRule({ id: 1 })
      ],
      { paid: ['2026-03-09'], skipped: ['2026-03-16'] }
    )
    const recurring = await recurringBlock(app)
    expect(recurring.upcoming.map(o => o.date)).toEqual([
      '2026-03-23',
      '2026-03-30',
      '2026-03-31',
      '2026-04-06',
      '2026-04-13',
      '2026-04-20'
    ])
    expect(recurring.upcoming[2]).toMatchObject({ rule_id: 1, name: 'Rent', amount: '100.000000000000', currency: 'USD', type: 'expense' })
  })

  it('keeps income rules out of the commitments total but in the list', async () => {
    const { app } = buildServer([
      stubRule({ id: 1 }),
      // The 5th of every month: the occurrence falling on today itself still counts
      stubRule({ id: 7, type: 'income', amount: '2500.000000000000', note: 'Payday', start_date: '2026-01-05', billing_anchor_day: 5, next_date: '2026-04-05' })
    ])
    const recurring = await recurringBlock(app)
    expect(recurring.monthly_commitments).toBe(100)
    expect(recurring.upcoming.find(o => o.rule_id === 7)).toMatchObject({ type: 'income', date: '2026-03-05' })
    expect(recurring.upcoming.find(o => o.rule_id === 1)).toMatchObject({ date: '2026-03-31' })
  })

  it('projects nothing when there are no rules', async () => {
    const { app } = buildServer([])
    const recurring = await recurringBlock(app)
    expect(recurring).toMatchObject({ monthly_commitments: 0, upcoming: [] })
  })
})
