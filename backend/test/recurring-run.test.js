import { describe, it, expect } from 'vitest'
import { generateOccurrences } from '../services/recurring-run.js'
import { buildStubDb, pgError } from './helpers/stub-db.js'

// The ledger writes the hourly cron makes for a rule, with the transaction and
// row lock owned by the caller. Dates come from planRuleRun, so what is owed is
// already decided by the schedule service; these tests pin what the database
// actually receives.

const OWNER = 7

function rule(overrides = {}) {
  return {
    id: 1,
    user_id: OWNER,
    account_id: 3,
    category_id: 5,
    amount: '31.500000000000',
    currency: 'USD',
    type: 'expense',
    frequency: 'monthly',
    interval_unit: 'month',
    interval_value: 1,
    billing_anchor_day: 31,
    start_date: '2026-01-31',
    next_date: '2026-01-31',
    end_date: null,
    cancellation_date: null,
    auto_renew: true,
    payment_limit: null,
    occurrences_paid: 0,
    last_run_date: null,
    note: 'Rent',
    is_active: true,
    ...overrides
  }
}

function run(ruleRow, today, { handlers = [], ...options } = {}) {
  // overrides first — the stub answers the first handler whose match hits
  const { db, queries } = buildStubDb([
    ...handlers,
    { match: /FROM transactions WHERE recurring_rule_id/, rows: () => [] },
    { match: /FROM recurring_exceptions/, rows: () => [] },
    { match: /INSERT INTO transactions/, rows: () => [{ id: 9 }] }
  ])
  return generateOccurrences(db, ruleRow, today, options).then(result => ({ result, queries }))
}
describe('generateOccurrences', () => {
  it('inserts each owed occurrence and moves the balance by the exact decimal', async () => {
    const { result, queries } = await run(rule(), '2026-03-31')
    const inserts = queries.filter(q => /INSERT INTO transactions/.test(q.sql))
    expect(inserts.map(q => q.params[5])).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(result.created).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(result.createdCount).toBe(3)
    const balances = queries.filter(q => /UPDATE accounts SET balance/.test(q.sql))
    expect(balances.map(b => b.params[0])).toEqual(['-31.5', '-31.5', '-31.5'])
    expect(balances[0].params[1]).toBe(3)
    // never an interval expression — the service owns the date math
    expect(queries.some(q => /INTERVAL/.test(q.sql))).toBe(false)
  })

  it('parks the cursor on the next future occurrence and bumps the counter once', async () => {
    const { result, queries } = await run(rule(), '2026-03-31')
    expect(result.nextDate).toBe('2026-04-30')
    expect(result.finished).toBe(false)
    const update = queries.find(q => /UPDATE recurring_rules SET/.test(q.sql))
    expect(update.sql).toMatch('occurrences_paid = occurrences_paid + $2')
    expect(update.params).toEqual(['2026-04-30', 3, '2026-03-31', true, 1])
  })

  it('credits an income rule instead of charging it', async () => {
    const { queries } = await run(rule({ type: 'income' }), '2026-01-31')
    const balance = queries.find(q => /UPDATE accounts SET balance/.test(q.sql))
    expect(balance.params[0]).toBe('31.5')
  })

  it('does not pay for a date the ledger already holds', async () => {
    const { result, queries } = await run(rule(), '2026-02-28', {
      handlers: [{ match: /FROM transactions WHERE recurring_rule_id/, rows: () => [{ date: '2026-01-31' }] }]
    })
    expect(result.created).toEqual(['2026-02-28'])
    expect(queries.filter(q => /INSERT INTO transactions/.test(q.sql)).length).toBe(1)
    expect(queries.filter(q => /UPDATE accounts SET balance/.test(q.sql)).length).toBe(1)
  })

  it('advances past a skipped date without touching the ledger', async () => {
    const { result, queries } = await run(rule(), '2026-03-31', {
      handlers: [{ match: /FROM recurring_exceptions/, rows: () => [{ date: '2026-02-28' }] }]
    })
    expect(result.created).toEqual(['2026-01-31', '2026-03-31'])
    expect(queries.filter(q => /INSERT INTO transactions/.test(q.sql)).length).toBe(2)
    expect(result.nextDate).toBe('2026-04-30')
  })

  it('treats a conflicting insert as already settled', async () => {
    const { result, queries } = await run(rule(), '2026-02-28', {
      handlers: [{ match: /INSERT INTO transactions/, rows: () => [] }]
    })
    expect(result.createdCount).toBe(0)
    expect(result.conflicted).toEqual(['2026-01-31', '2026-02-28'])
    expect(queries.some(q => /UPDATE accounts SET balance/.test(q.sql))).toBe(false)
    const update = queries.find(q => /UPDATE recurring_rules SET/.test(q.sql))
    expect(update.params[1]).toBe(0)
  })

  it('records what the catch-up cap had to rewind', async () => {
    const { result, queries } = await run(
      rule({ interval_unit: 'day', start_date: '2026-01-01', next_date: '2026-01-01' }),
      '2026-01-30',
      { limit: 2 }
    )
    expect(result.created).toEqual(['2026-01-01', '2026-01-02'])
    expect(result.rewound.length).toBe(28)
    const history = queries.filter(q => /INSERT INTO recurring_history/.test(q.sql))
    expect(history.length).toBe(28)
    expect(history[0].params[2]).toBe('skipped')
    expect(JSON.parse(history[0].params[4])).toEqual({ date: '2026-01-03', reason: 'catch_up_limit' })
  })

  it('deactivates a rule whose schedule ran out and logs it as ended', async () => {
    const { result, queries } = await run(rule({ auto_renew: false }), '2026-05-31')
    expect(result.created).toEqual(['2026-01-31'])
    expect(result.finished).toBe(true)
    expect(result.nextDate).toBe('2026-01-31')
    const update = queries.find(q => /UPDATE recurring_rules SET/.test(q.sql))
    expect(update.params[3]).toBe(false)
    const ended = queries.filter(q => /INSERT INTO recurring_history/.test(q.sql)).pop()
    expect(ended.params[2]).toBe('ended')
    expect(JSON.parse(ended.params[4])).toEqual({ is_active: false, last_date: '2026-01-31' })
  })

  it('lets the caller own the transaction when a write fails', async () => {
    const { db, queries } = buildStubDb([
      { match: /FROM transactions WHERE recurring_rule_id/, rows: () => [] },
      { match: /FROM recurring_exceptions/, rows: () => [] },
      { match: /INSERT INTO transactions/, throws: () => pgError('23505', 'transactions_pkey') }
    ])
    await expect(generateOccurrences(db, rule(), '2026-03-31')).rejects.toThrow(/duplicate key/)
    // The service never opens or closes a transaction: the cron pass rolls the
    // locked rule back, so a half-written occurrence cannot survive.
    expect(queries.some(q => /BEGIN|COMMIT|ROLLBACK/.test(q.sql))).toBe(false)
  })

  it('leaves a rule that is not due yet alone', async () => {
    const { result, queries } = await run(rule({ next_date: '2026-05-31' }), '2026-03-31')
    expect(result.created).toEqual([])
    expect(result.nextDate).toBe('2026-05-31')
    expect(queries.some(q => /INSERT INTO transactions/.test(q.sql))).toBe(false)
    expect(queries.some(q => /UPDATE recurring_rules SET/.test(q.sql))).toBe(false)
  })
})
