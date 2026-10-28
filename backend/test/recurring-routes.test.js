import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import recurringRoutes from '../routes/recurring.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

// Contract of backend/routes/recurring.js — see scripts/blackbox-test.mjs for the
// live-database run of the same routes.

function baseRule(overrides = {}) {
  return {
    id: 1,
    user_id: USER,
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
    next_date: '2026-03-31',
    end_date: null,
    cancellation_date: null,
    auto_renew: true,
    payment_limit: null,
    occurrences_paid: 2,
    last_run_date: '2026-02-28',
    notify_days_before: 0,
    note: 'Rent',
    is_active: true,
    account_name: 'Checking',
    category_name: 'Housing',
    owner_login: null,
    is_shared: false,
    ...overrides
  }
}

function buildServer(handlers = []) {
  return buildStubServer(recurringRoutes, handlers)
}

const CURRENT_DATE = { match: /CURRENT_DATE/, rows: () => [{ today: '2026-03-05' }] }

describe('GET /recurring', () => {
  it('returns calendar days as text and adds the computed schedule state', async () => {
    const { app } = buildServer([
      CURRENT_DATE,
      { match: /FROM recurring_rules/, rows: () => [baseRule()] },
      { match: /FROM transactions/, rows: () => [] },
      { match: /FROM recurring_exceptions/, rows: () => [] }
    ])
    const res = await app.inject({ method: 'GET', url: '/recurring' })
    expect(res.statusCode).toBe(200)
    const [rule] = res.json()
    expect(rule.next_date).toBe('2026-03-31')
    expect(rule.start_date).toBe('2026-01-31')
    expect(rule.last_run_date).toBe('2026-02-28')
    expect(rule.status).toBe('scheduled')
    expect(rule.monthly_equivalent).toBe('31.50')
    expect(rule.next_occurrence).toBe('2026-03-31')
    await app.close()
  })

  it('marks an unpaid past occurrence overdue and a skipped one settled', async () => {
    const { app } = buildServer([
      CURRENT_DATE,
      { match: /FROM recurring_rules/, rows: () => [baseRule({ next_date: '2026-03-01', billing_anchor_day: 1, start_date: '2026-01-01' })] },
      { match: /FROM transactions/, rows: () => [] },
      { match: /FROM recurring_exceptions/, rows: () => [] }
    ])
    const res = await app.inject({ method: 'GET', url: '/recurring' })
    expect(res.json()[0].status).toBe('overdue')
    await app.close()
  })
})

describe('GET /recurring/occurrences', () => {
  it('projects the window and flags paid and skipped dates', async () => {
    const { app } = buildServer([
      CURRENT_DATE,
      { match: /FROM recurring_rules/, rows: () => [baseRule()] },
      { match: /FROM transactions/, rows: () => [{ rule_id: 1, date: '2026-01-31' }] },
      { match: /FROM recurring_exceptions/, rows: () => [{ rule_id: 1, date: '2026-02-28' }] }
    ])
    const res = await app.inject({
      method: 'GET',
      url: '/recurring/occurrences?from=2026-01-01&to=2026-04-30'
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.from).toBe('2026-01-01')
    expect(body.occurrences.map(o => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(body.occurrences[0].paid).toBe(true)
    expect(body.occurrences[1].skipped).toBe(true)
    expect(body.occurrences[2].paid).toBe(false)
    expect(body.occurrences[0].amount).toBe('31.500000000000')
    await app.close()
  })

  it('refuses a window wider than the projection can scan', async () => {
    const { app } = buildServer([CURRENT_DATE])
    const res = await app.inject({
      method: 'GET',
      url: '/recurring/occurrences?from=2026-01-01&to=2027-12-31'
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBeTruthy()
    await app.close()
  })

  it('refuses bounds that are not dates', async () => {
    const { app } = buildServer([CURRENT_DATE])
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-02-30&to=2026-03-30' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /recurring', () => {
  it('derives the interval columns from a legacy frequency body', async () => {
    const { app, queries } = buildServer([
      CURRENT_DATE,
      { match: /FROM accounts/, rows: () => [{ id: 3 }] },
      { match: /INSERT INTO recurring_rules/, rows: () => [baseRule()] }
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/recurring',
      payload: { account_id: 3, amount: 31.5, type: 'expense', frequency: 'monthly', next_date: '2026-03-31' }
    })
    expect(res.statusCode).toBe(201)
    const insert = queries.find(q => /INSERT INTO recurring_rules/.test(q.sql))
    expect(insert.params).toContain('month')
    expect(insert.params).toContain(1)
    expect(insert.params).toContain('2026-03-31')
    // start_date falls back to the first scheduled day, anchor to its day
    expect(insert.sql).toMatch('start_date')
    expect(insert.sql).toMatch('billing_anchor_day')
    await app.close()
  })

  it('keeps an explicit interval and writes a coherent legacy frequency for rollback', async () => {
    const { app, queries } = buildServer([
      CURRENT_DATE,
      { match: /FROM accounts/, rows: () => [{ id: 3 }] },
      { match: /INSERT INTO recurring_rules/, rows: () => [baseRule()] }
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/recurring',
      payload: {
        account_id: 3,
        amount: 31.5,
        type: 'expense',
        interval_unit: 'month',
        interval_value: 3,
        billing_anchor_day: 31,
        start_date: '2026-01-31'
      }
    })
    expect(res.statusCode).toBe(201)
    const insert = queries.find(q => /INSERT INTO recurring_rules/.test(q.sql))
    expect(insert.params).toContain('monthly')
    expect(insert.params).toContain(3)
    const history = queries.find(q => /INSERT INTO recurring_history/.test(q.sql))
    expect(history.params).toContain('created')
    await app.close()
  })

  it('rejects a date the calendar does not have', async () => {
    const { app } = buildServer([
      CURRENT_DATE,
      { match: /FROM accounts/, rows: () => [{ id: 3 }] }
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/recurring',
      payload: { account_id: 3, amount: 10, type: 'expense', frequency: 'monthly', start_date: '2026-02-31' }
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects a schedule that has nothing left to pay', async () => {
    const { app } = buildServer([
      CURRENT_DATE,
      { match: /FROM accounts/, rows: () => [{ id: 3 }] }
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/recurring',
      payload: {
        account_id: 3,
        amount: 10,
        type: 'expense',
        interval_unit: 'month',
        start_date: '2026-01-31',
        end_date: '2026-02-01'
      }
    })
    expect(res.statusCode).toBe(400)
    // Fastify puts schema rejections in `validation`; a 400 without it can only
    // come from the schedule itself.
    expect(res.json().validation).toBeUndefined()
    await app.close()
  })
})

describe('PATCH /recurring/:id', () => {
  const patchHandlers = (rule = baseRule()) => [
    CURRENT_DATE,
    { match: /FROM recurring_rules/, rows: () => [rule] },
    { match: /UPDATE recurring_rules/, rows: () => [rule] },
    { match: /FROM accounts/, rows: () => [{ id: 3 }] }
  ]

  it('answers an empty patch instead of writing nothing', async () => {
    const { app } = buildServer(patchHandlers())
    const res = await app.inject({ method: 'PATCH', url: '/recurring/1', payload: {} })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('only binds the columns that were sent — currency survives an amount edit', async () => {
    const { app, queries } = buildServer(patchHandlers())
    const res = await app.inject({ method: 'PATCH', url: '/recurring/1', payload: { amount: 42 } })
    expect(res.statusCode).toBe(200)
    const update = queries.find(q => /UPDATE recurring_rules/.test(q.sql))
    expect(update.sql).toMatch('SET amount = $1')
    expect(update.sql).not.toMatch(/currency =/)
    expect(update.sql).toMatch('updated_at = now()')
    expect(update.params).not.toContain(undefined)
    expect(update.params[0]).toBe(42)
    await app.close()
  })

  it('re-derives frequency and the cursor when the schedule changes', async () => {
    const { app, queries } = buildServer(patchHandlers())
    const res = await app.inject({
      method: 'PATCH',
      url: '/recurring/1',
      payload: { interval_unit: 'year', interval_value: 1 }
    })
    expect(res.statusCode).toBe(200)
    const update = queries.find(q => /UPDATE recurring_rules/.test(q.sql))
    expect(update.params).toContain('yearly')
    // anchor 31, yearly, today 2026-03-05 → next occurrence 2027-01-31?
    // start_date is 2026-01-31, so the next yearly step is 2027-01-31
    expect(update.params).toContain('2027-01-31')
    const history = queries.find(q => /INSERT INTO recurring_history/.test(q.sql))
    expect(history.params).toContain('schedule_changed')
    await app.close()
  })

  it('records pause and resume in history', async () => {
    const { app, queries } = buildServer(patchHandlers())
    await app.inject({ method: 'PATCH', url: '/recurring/1', payload: { is_active: false } })
    const history = queries.find(q => /INSERT INTO recurring_history/.test(q.sql))
    expect(history.params).toContain('paused')
    await app.close()
  })

  it('records a price change with the old and new amount', async () => {
    const { app, queries } = buildServer(patchHandlers())
    await app.inject({ method: 'PATCH', url: '/recurring/1', payload: { amount: 40 } })
    const history = queries.find(q => /INSERT INTO recurring_history/.test(q.sql))
    expect(history.params).toContain('price_changed')
    expect(JSON.parse(history.params[3]).amount).toBe('31.500000000000')
    await app.close()
  })

  it('leaves next_date alone rather than inventing a cursor', async () => {
    const { app, queries } = buildServer(patchHandlers(baseRule({ end_date: '2026-02-01' })))
    const res = await app.inject({ method: 'PATCH', url: '/recurring/1', payload: { note: 'changed' } })
    expect(res.statusCode).toBe(200)
    const update = queries.find(q => /UPDATE recurring_rules/.test(q.sql))
    expect(update.sql).not.toMatch(/next_date =/)
    await app.close()
  })
})

describe('PUT /recurring/:id', () => {
  it('is marked deprecated and keeps the stored currency', async () => {
    const { app, queries } = buildServer([
      CURRENT_DATE,
      { match: /FROM recurring_rules/, rows: () => [baseRule()] },
      { match: /UPDATE recurring_rules/, rows: () => [baseRule()] },
      { match: /FROM accounts/, rows: () => [{ id: 3 }] }
    ])
    const res = await app.inject({
      method: 'PUT',
      url: '/recurring/1',
      payload: { account_id: 3, amount: 40, type: 'expense', frequency: 'monthly', next_date: '2026-04-30' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers.deprecation).toBe('true')
    const update = queries.find(q => /UPDATE recurring_rules/.test(q.sql))
    expect(update.params).not.toContain(undefined)
    expect(update.sql).not.toMatch(/currency =/)
    await app.close()
  })
})

describe('occurrence payments', () => {
  const paidHandlers = (paid = []) => [
    CURRENT_DATE,
    { match: /FROM recurring_rules/, rows: () => [baseRule()] },
    { match: /INSERT INTO transactions/, rows: () => [{ id: 9 }] },
    { match: /INSERT INTO recurring_exceptions/, rows: () => [{ id: 11 }] },
    { match: /FROM transactions/, rows: () => paid },
    { match: /FROM recurring_exceptions/, rows: () => [] },
    { match: /FROM accounts/, rows: () => [{ id: 3 }] }
  ]

  it('refuses to pay a date the schedule never generates', async () => {
    const { app, queries } = buildServer(paidHandlers())
    const res = await app.inject({
      method: 'POST',
      url: '/recurring/occurrences/pay',
      payload: { rule_id: 1, date: '2026-03-15' }
    })
    expect(res.statusCode).toBe(400)
    expect(queries.some(q => /INSERT INTO transactions/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('refuses a date that is already paid', async () => {
    const { app } = buildServer(paidHandlers([{ rule_id: 1, date: '2026-03-31', id: 9 }]))
    const res = await app.inject({
      method: 'POST',
      url: '/recurring/occurrences/pay',
      payload: { rule_id: 1, date: '2026-03-31' }
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('pays a scheduled date: transaction, balance and counter in one commit', async () => {
    const { app, queries } = buildServer(paidHandlers())
    const res = await app.inject({
      method: 'POST',
      url: '/recurring/occurrences/pay',
      payload: { rule_id: 1, date: '2026-03-31' }
    })
    expect(res.statusCode).toBe(201)
    expect(queries.some(q => /INSERT INTO transactions/.test(q.sql))).toBe(true)
    const balance = queries.find(q => /UPDATE accounts SET balance/.test(q.sql))
    // expense 31.5 → the balance moves by the exact decimal, never a float
    expect(balance.params[0]).toBe('-31.5')
    expect(queries.some(q => /occurrences_paid = occurrences_paid \+ 1/.test(q.sql))).toBe(true)
    expect(queries.some(q => /COMMIT/.test(q.sql))).toBe(true)
    expect(queries.some(q => /ROLLBACK/.test(q.sql))).toBe(false)
    const history = queries.find(q => /INSERT INTO recurring_history/.test(q.sql))
    expect(history.params).toContain('paid')
    await app.close()
  })

  it('reverts the balance by the stored amount when the payment is undone', async () => {
    const { app, queries } = buildServer(paidHandlers([{ rule_id: 1, date: '2026-03-31', id: 9, amount: '31.500000000000', type: 'expense' }]))
    const res = await app.inject({
      method: 'DELETE',
      url: '/recurring/occurrences/pay',
      payload: { rule_id: 1, date: '2026-03-31' }
    })
    expect(res.statusCode).toBe(200)
    const balance = queries.find(q => /UPDATE accounts SET balance/.test(q.sql))
    expect(balance.params[0]).toBe('31.5')
    expect(queries.some(q => /DELETE FROM transactions/.test(q.sql))).toBe(true)
    await app.close()
  })

  it('skips an occurrence without touching the ledger', async () => {
    const { app, queries } = buildServer(paidHandlers())
    const res = await app.inject({
      method: 'POST',
      url: '/recurring/occurrences/skip',
      payload: { rule_id: 1, date: '2026-03-31' }
    })
    expect(res.statusCode).toBe(201)
    expect(queries.some(q => /INSERT INTO recurring_exceptions/.test(q.sql))).toBe(true)
    expect(queries.some(q => /INSERT INTO transactions/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('creates the due occurrence on demand and stays idempotent', async () => {
    const { app, queries } = buildServer(paidHandlers())
    const res = await app.inject({ method: 'POST', url: '/recurring/1/run-now' })
    expect(res.statusCode).toBe(200)
    expect(res.json().occurrence).toBe('2026-03-31')
    const insert = queries.find(q => /INSERT INTO transactions/.test(q.sql))
    expect(insert.sql).toMatch('ON CONFLICT (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL')
    await app.close()
  })

  it('refuses to let a shared viewer pay on someone else\'s rule', async () => {
    const owned = buildServer([
      CURRENT_DATE,
      { match: /FROM recurring_rules/, rows: () => [baseRule({ user_id: 99, owner_login: 'mum' })] },
      { match: /FROM transactions/, rows: () => [] },
      { match: /FROM recurring_exceptions/, rows: () => [] }
    ])
    const deny = await owned.app.inject({
      method: 'POST',
      url: '/recurring/occurrences/pay',
      payload: { rule_id: 1, date: '2026-03-31' }
    })
    expect(deny.statusCode).toBe(403)
    expect(owned.queries.some(q => /INSERT INTO transactions/.test(q.sql))).toBe(false)
    await owned.app.close()
  })
})

describe('GET /recurring/:id/history', () => {
  it('returns the newest events first', async () => {
    const { app } = buildServer([
      CURRENT_DATE,
      { match: /FROM recurring_rules/, rows: () => [baseRule()] },
      { match: /FROM recurring_history/, rows: () => [{ id: 2, event_type: 'paused' }, { id: 1, event_type: 'created' }] }
    ])
    const res = await app.inject({ method: 'GET', url: '/recurring/1/history' })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0].event_type).toBe('paused')
    await app.close()
  })
})

describe('backend locales', () => {
  const newKeys = [
    'invalid_date_range',
    'occurrence_not_scheduled',
    'occurrence_already_paid',
    'occurrence_not_paid',
    'schedule_never_occurs',
    'rule_not_editable',
    'occurrence_date_taken'
  ]

  it('defines every recurring error key in both languages', () => {
    for (const file of ['en.json', 'ru.json']) {
      const catalog = JSON.parse(readFileSync(new URL(`../locales/${file}`, import.meta.url), 'utf-8'))
      for (const key of newKeys) {
        expect(catalog.errors[key], `${file} errors.${key}`).toBeTypeOf('string')
      }
    }
  })
})
