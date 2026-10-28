import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import recurringRoutes from '../routes/recurring.js'
import { buildStubDb, buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

// Contract of the subscription feed: a token in the query string stands in for a
// login, so the only thing that may ever reach PostgreSQL is its sha256 digest,
// and the payload is the same projection the Recurring page draws.

const TOKEN = '3f2b1c9a-7d4e-4c1b-9a6f-0e2d5b8c1a44'
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex')
const TODAY = '2026-03-05'

function rule(overrides = {}) {
  return {
    id: 1,
    user_id: USER,
    account_id: 3,
    category_id: 5,
    amount: '15.990000000000',
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
    occurrences_paid: 2,
    last_run_date: '2026-02-05',
    notify_days_before: 0,
    note: 'Streaming',
    is_active: true,
    account_name: 'Checking',
    category_name: 'Subscriptions',
    owner_login: null,
    is_shared: false,
    ...overrides
  }
}

function feedServer({ tokenRows = [], rules = [], paid = [], skipped = [] } = {}) {
  return buildStubServer(recurringRoutes, [
    { match: /FROM recurring_feed_tokens/, rows: tokenRows },
    { match: /UPDATE recurring_feed_tokens[\s\S]*last_used_at/, rows: [] },
    { match: /CURRENT_DATE/, rows: () => [{ today: TODAY }] },
    { match: /FROM recurring_rules r/, rows: () => rules },
    { match: /FROM transactions WHERE recurring_rule_id/, rows: () => paid },
    { match: /FROM recurring_exceptions/, rows: () => skipped },
    { match: /INSERT INTO recurring_feed_tokens/, rows: () => [{ id: 9, name: 'Phone calendar', created_at: '2026-03-05T00:00:00.000Z' }] },
    { match: /UPDATE recurring_feed_tokens[\s\S]*revoked_at/, rows: () => [{ id: 9 }] }
  ])
}

describe('GET /recurring.ics', () => {
  it('authenticates by digest, never by the plaintext token', async () => {
    const { app, queries } = feedServer({
      tokenRows: [{ user_id: USER, id: 9 }],
      rules: [rule()]
    })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.statusCode).toBe(200)
    const lookup = queries.find(entry => /FROM recurring_feed_tokens/.test(entry.sql))
    expect(lookup.params).toEqual([TOKEN_HASH])
    expect(JSON.stringify(queries)).not.toContain(TOKEN)
  })

  it('serves a calendar with the occurrences due from today', async () => {
    const { app } = feedServer({ tokenRows: [{ user_id: USER, id: 9 }], rules: [rule()] })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    expect(res.body).toContain('BEGIN:VCALENDAR')
    expect(res.body).toContain('SUMMARY:Streaming')
    expect(res.body).toContain('DTSTART;VALUE=DATE:20260305')
    expect(res.body).toContain('DTSTART;VALUE=DATE:20260405')
  })

  it('stops the feed 180 days out', async () => {
    const { app } = feedServer({ tokenRows: [{ user_id: USER, id: 9 }], rules: [rule()] })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    // 2026-03-05 + 180 days is 2026-09-01, so the September-05th billing is out.
    expect(res.body).toContain('DTSTART;VALUE=DATE:20260805')
    expect(res.body).not.toContain('DTSTART;VALUE=DATE:20260905')
  })

  it('marks an occurrence already paid', async () => {
    const { app } = feedServer({
      tokenRows: [{ user_id: USER, id: 9 }],
      rules: [rule()],
      paid: [{ rule_id: 1, date: '2026-03-05' }]
    })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.body).toContain('X-FINAPP-PAID:20260305')
    expect(res.body).toContain('DTSTART;VALUE=DATE:20260405')
  })

  it('leaves a skipped occurrence out', async () => {
    const { app } = feedServer({
      tokenRows: [{ user_id: USER, id: 9 }],
      rules: [rule()],
      skipped: [{ rule_id: 1, date: '2026-04-05' }]
    })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.body).not.toContain('DTSTART;VALUE=DATE:20260405')
    expect(res.body).toContain('DTSTART;VALUE=DATE:20260305')
  })

  it('drops paused rules from the feed', async () => {
    const { app } = feedServer({
      tokenRows: [{ user_id: USER, id: 9 }],
      rules: [rule({ is_active: false })]
    })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.body).toContain('BEGIN:VCALENDAR')
    expect(res.body).not.toContain('BEGIN:VEVENT')
  })

  it('rejects an unknown token without a calendar body', async () => {
    const { app } = feedServer({ tokenRows: [], rules: [rule()] })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.statusCode).toBe(401)
    expect(res.body).not.toContain('BEGIN:VCALENDAR')
  })

  it('rejects a link with no token at all as a malformed request', async () => {
    const { app } = feedServer({ tokenRows: [{ user_id: USER, id: 9 }], rules: [rule()] })
    const res = await app.inject({ method: 'GET', url: '/recurring.ics' })
    // No token is a broken URL (400); a token that does not resolve is a
    // credential that stopped working (401).
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain('BEGIN:VCALENDAR')
  })

  it('touches last_used_at on the token row', async () => {
    const { app, queries } = feedServer({ tokenRows: [{ user_id: USER, id: 9 }], rules: [rule()] })
    await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    const touch = queries.find(entry => /UPDATE recurring_feed_tokens[\s\S]*last_used_at/.test(entry.sql))
    expect(touch.params).toEqual([TOKEN_HASH])
  })

  it('tells a calendar client not to cache the projection', async () => {
    const { app } = feedServer({ tokenRows: [{ user_id: USER, id: 9 }], rules: [rule()] })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.headers['cache-control']).toContain('no-store')
  })
})

describe('feed token management', () => {
  it('creates a token and shows the plaintext exactly once', async () => {
    const { app, queries } = feedServer()
    const res = await app.inject({ method: 'POST', url: '/recurring/feed-tokens', payload: { name: 'Phone calendar' } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('Phone calendar')
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/)
    const insert = queries.find(entry => /INSERT INTO recurring_feed_tokens/.test(entry.sql))
    expect(insert.params[0]).toBe(USER)
    expect(insert.params[2]).toBe(crypto.createHash('sha256').update(body.token).digest('hex'))
  })

  it('rejects a blank token name', async () => {
    const { app } = feedServer()
    const res = await app.inject({ method: 'POST', url: '/recurring/feed-tokens', payload: { name: '' } })
    expect(res.statusCode).toBe(400)
  })

  it('lists tokens without any secret material', async () => {
    const { app } = feedServer({
      tokenRows: [{ id: 9, name: 'Phone calendar', created_at: '2026-03-05T00:00:00.000Z', last_used_at: null, revoked_at: null }]
    })
    const res = await app.inject({ method: 'GET', url: '/recurring/feed-tokens' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { id: 9, name: 'Phone calendar', created_at: '2026-03-05T00:00:00.000Z', last_used_at: null, revoked_at: null }
    ])
  })

  it('revokes instead of deleting, so a stale feed URL stops working', async () => {
    const { app, queries } = feedServer()
    const res = await app.inject({ method: 'DELETE', url: '/recurring/feed-tokens/9' })
    expect(res.statusCode).toBe(204)
    const revoke = queries.find(entry => /UPDATE recurring_feed_tokens[\s\S]*revoked_at/.test(entry.sql))
    expect(revoke.params).toEqual([9, USER])
    expect(queries.some(entry => /DELETE FROM recurring_feed_tokens/.test(entry.sql))).toBe(false)
  })
})

describe('feed rate limit', () => {
  it('counts guessed tokens from one address against one bucket', async () => {
    const { db } = buildStubDb([{ match: /FROM recurring_feed_tokens/, rows: [] }])
    const app = Fastify()
    app.decorate('db', db)
    await app.register(rateLimit, { global: false })
    await app.register(recurringRoutes)
    const statuses = []
    for (let i = 0; i < 31; i++) {
      const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${crypto.randomUUID()}`, remoteAddress: '203.0.113.7' })
      statuses.push(res.statusCode)
    }
    expect(statuses.slice(0, 30).every(code => code === 401)).toBe(true)
    expect(statuses[30]).toBe(429)
    // another address keeps its own budget
    const other = await app.inject({ method: 'GET', url: `/recurring.ics?token=${crypto.randomUUID()}`, remoteAddress: '203.0.113.8' })
    expect(other.statusCode).toBe(401)
    await app.close()
  })
})
