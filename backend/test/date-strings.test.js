import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import Fastify from 'fastify'
import reportRoutes from '../routes/reports.js'
import demodataRoutes from '../routes/demodata.js'
import { buildStubServer } from './helpers/stub-db.js'

// Production runs the container on TZ=Asia/Vladivostok (UTC+10) and PostgreSQL
// on UTC. Every check here runs on that process timezone: a DATE handled as a
// local-midnight Date, or a calendar day taken from the Node clock, lands on
// the wrong day.
const originalTz = process.env.TZ
process.env.TZ = 'Asia/Vladivostok'

let pg
let defaultDateParser
let dbPlugin
let POOL_OPTIONS

beforeAll(async () => {
  pg = (await import('pg')).default
  // Captured before plugins/db.js registers its override
  defaultDateParser = pg.types.getTypeParser(pg.types.builtins.DATE)
  ;({ default: dbPlugin, POOL_OPTIONS } = await import('../plugins/db.js'))
})

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

afterEach(() => {
  vi.useRealTimers()
})

// 2026-03-31 20:00 UTC: PostgreSQL's CURRENT_DATE is still March 31, while the
// Node clock in Vladivostok already reads April 1, 06:00.
function nodeClockAheadOfDatabase() {
  vi.useFakeTimers({ now: new Date('2026-03-31T20:00:00Z'), toFake: ['Date'] })
  expect(new Date().getDate()).toBe(1)
}

describe('pg DATE parsing', () => {
  it('runs in the production timezone', () => {
    expect(new Date(2026, 9, 29).getTimezoneOffset()).toBe(-600)
  })

  it('shows the bug the override fixes: the default parser moves the day back', () => {
    expect(JSON.stringify(defaultDateParser('2026-10-29'))).toBe('"2026-10-28T14:00:00.000Z"')
  })

  it('keeps DATE as the YYYY-MM-DD text PostgreSQL sends', () => {
    expect(pg.types.getTypeParser(pg.types.builtins.DATE)('2026-10-29')).toBe('2026-10-29')
  })

  it('returns DATE columns of a result row as strings and leaves TIMESTAMP alone', () => {
    const result = new pg.Result()
    result.addFields([
      { name: 'date', dataTypeID: pg.types.builtins.DATE, format: 'text' },
      { name: 'due_date', dataTypeID: pg.types.builtins.DATE, format: 'text' },
      { name: 'created_at', dataTypeID: pg.types.builtins.TIMESTAMP, format: 'text' }
    ])
    const row = result.parseRow(['2026-10-29', null, '2026-10-29 01:02:03'])
    expect(row.date).toBe('2026-10-29')
    expect(row.due_date).toBeNull()
    expect(row.created_at).toBeInstanceOf(Date)
    // What a route returns for a `RETURNING *` row: the edit form gets the day back
    expect(JSON.parse(JSON.stringify(row)).date).toBe('2026-10-29')
  })
})

describe('db pool', () => {
  it('sets a server-side statement timeout and an idle timeout', () => {
    expect(POOL_OPTIONS.statement_timeout).toBe(30000)
    expect(POOL_OPTIONS.idleTimeoutMillis).toBeGreaterThan(0)
  })

  it('logs an idle-client error instead of crashing the process', async () => {
    const savedUrl = process.env.DATABASE_URL
    // The pool connects lazily; nothing here opens a connection
    process.env.DATABASE_URL = 'postgres://user:pass@127.0.0.1:1/none'
    const app = Fastify()
    app.register(dbPlugin)
    await app.ready()
    try {
      const logged = vi.spyOn(app.log, 'error').mockImplementation(() => {})
      expect(app.db.listenerCount('error')).toBe(1)
      expect(app.db.options.statement_timeout).toBe(30000)
      // An EventEmitter without an 'error' listener throws here
      expect(() => app.db.emit('error', new Error('terminating connection'))).not.toThrow()
      expect(logged).toHaveBeenCalledOnce()
    } finally {
      await app.close()
      if (savedUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = savedUrl
    }
  })
})

describe('GET /reports/net-worth', () => {
  it('ends the month list at the database month, not the Node clock month', async () => {
    nodeClockAheadOfDatabase()
    const { app } = buildStubServer(reportRoutes, [
      { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today: '2026-03-31' }] },
      { match: /UNION/, rows: () => [{ id: 1 }] },
      { match: /FROM exchange_rates/, rows: () => [] },
      { match: /FROM accounts WHERE id = ANY/, rows: () => [{ balance: '1000', currency: 'USD' }] },
      { match: /FROM transactions t/, rows: () => [] }
    ])
    const res = await app.inject({ method: 'GET', url: '/reports/net-worth?months=3' })
    expect(res.statusCode).toBe(200)
    expect(res.json().map(m => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('crosses a year boundary going back', async () => {
    const { app } = buildStubServer(reportRoutes, [
      { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today: '2026-01-15' }] },
      { match: /UNION/, rows: () => [{ id: 1 }] },
      { match: /FROM accounts WHERE id = ANY/, rows: () => [] }
    ])
    const res = await app.inject({ method: 'GET', url: '/reports/net-worth?months=3' })
    expect(res.json().map(m => m.month)).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('POST /admin/load-demo', () => {
  it('dates demo rows from the database day', async () => {
    nodeClockAheadOfDatabase()
    let nextId = 100
    const { app, queries } = buildStubServer(demodataRoutes, [
      { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today: '2026-03-31' }] },
      { match: /SELECT 1 FROM accounts/, rows: () => [] },
      { match: /FROM exchange_rates/, rows: () => [] },
      { match: /SELECT id FROM (categories|tags)/, rows: () => [{ id: 1 }] },
      { match: /RETURNING id/, rows: () => [{ id: nextId++ }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/admin/load-demo' })
    expect(res.statusCode).toBe(200)

    const inserts = table => queries.filter(q => q.sql.startsWith(`INSERT INTO ${table} `))
    expect(inserts('debts').map(q => q.params[6])).toEqual(['2026-04-15', '2026-09-01'])
    expect(inserts('recurring_rules').map(q => q.params[7])).toEqual(['2026-04-05', '2026-04-10', '2026-04-15'])
    expect(new Set(inserts('budgets').map(q => q.params[5]))).toEqual(new Set(['2026-03-31']))

    const txDates = inserts('transactions').map(q => q.params[5])
    expect(txDates.every(d => d >= '2026-03-01' && d <= '2026-03-31')).toBe(true)
    expect(txDates).toContain('2026-03-31')
    // Salary lands on the 1st and the 15th of the database calendar
    const salaryDates = inserts('transactions').filter(q => q.params[6] === 'Salary').map(q => q.params[5])
    expect(salaryDates).toEqual(['2026-03-01', '2026-03-15'])
  })
})
