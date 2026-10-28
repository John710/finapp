import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import currencyRoutes, { cryptoSymbolsToPrice, MANUAL_REFRESH_MIN_INTERVAL_MINUTES } from '../routes/currencies.js'
import { buildStubDb, TEST_USER } from './helpers/stub-db.js'

function buildServer(handlers) {
  const { db, queries } = buildStubDb(handlers)
  const app = Fastify()
  const jobs = []
  app.decorate('db', db)
  app.decorate('schedule', (cron, job) => jobs.push({ cron, job }))
  app.addHook('preHandler', async request => {
    request.user = { userId: TEST_USER }
  })
  app.register(currencyRoutes)
  return { app, queries, jobs }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cryptoSymbolsToPrice', () => {
  it('prices every user\'s crypto tickers for the daily job', async () => {
    const { db, queries } = buildStubDb([
      { match: /FROM accounts/, rows: () => [{ currency: 'BTC' }, { currency: 'SOL' }] }
    ])
    expect(await cryptoSymbolsToPrice(db, 1, { allUsers: true })).toEqual(['btc', 'sol'])
    expect(queries[0].sql).not.toContain('user_id')
    expect(queries[0].params).toEqual([])
  })

  it('scopes a manual refresh to the caller', async () => {
    const { db, queries } = buildStubDb([])
    await cryptoSymbolsToPrice(db, 5)
    expect(queries[0].sql).toContain('user_id = $1')
    expect(queries[0].params).toEqual([5])
  })
})

describe('POST /currencies/update', () => {
  it('refuses a refresh while the last one is younger than the window, without calling out', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { app, queries } = buildServer([
      { match: /MAX\(updated_at\)/, rows: () => [{ fresh: true }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/currencies/update' })
    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe(String(MANUAL_REFRESH_MIN_INTERVAL_MINUTES * 60))
    expect(res.json().error).toContain(String(MANUAL_REFRESH_MIN_INTERVAL_MINUTES))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(queries.some(q => /INSERT INTO exchange_rates/.test(q.sql))).toBe(false)
  })

  it('refreshes when the rates are stale', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => (String(url).includes('fawazahmed0') ? { usd: { eur: 0.9 } } : { btc: { usd: 50000 } })
    })))
    const { app, queries } = buildServer([
      { match: /MAX\(updated_at\)/, rows: () => [{ fresh: false }] },
      { match: /FROM accounts/, rows: () => [{ currency: 'BTC' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/currencies/update' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true, cryptoUpdated: 1 })
    expect(queries.some(q => /INSERT INTO exchange_rates/.test(q.sql))).toBe(true)
  })

  it('lets only one refresh run at a time', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate
      return { ok: false, status: 503, headers: new Headers(), json: async () => ({}) }
    }))
    const { app } = buildServer([
      { match: /MAX\(updated_at\)/, rows: () => [{ fresh: false }] }
    ])
    const first = app.inject({ method: 'POST', url: '/currencies/update' })
    // let the first request reach the provider call
    await new Promise(resolve => setTimeout(resolve, 50))
    const second = await app.inject({ method: 'POST', url: '/currencies/update' })
    expect(second.statusCode).toBe(429)
    release()
    expect((await first).statusCode).toBe(502)
  })
})

describe('daily refresh', () => {
  it('prices the crypto of every user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ usd: {} })
    })))
    const { app, queries, jobs } = buildServer([
      { match: /FROM users ORDER BY/, rows: () => [{ id: 1 }] }
    ])
    await app.ready()
    expect(jobs).toHaveLength(1)
    await jobs[0].job()
    const symbols = queries.find(q => /type = 'crypto'/.test(q.sql))
    expect(symbols.sql).not.toContain('user_id')
  })
})
