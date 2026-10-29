import { describe, it, expect, vi, afterEach } from 'vitest'
import demodataRoutes, { randomAmount } from '../routes/demodata.js'
import { buildStubServer } from './helpers/stub-db.js'

// Demo amounts reach numeric(24,12) columns as decimal strings: a float from
// Math.random() only picks the value.

const NUMERIC = /^-?\d+(\.\d+)?$/

afterEach(() => {
  vi.restoreAllMocks()
})

describe('randomAmount', () => {
  it('returns a fixed-decimal string inside the range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(randomAmount(10, 50)).toBe('59.99')
    expect(randomAmount('0.0001', '0.001', 8)).toBe('0.00109999')
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(randomAmount(2500, 300)).toBe('2500.00')
  })
})

describe('POST /admin/load-demo', () => {
  it('writes every amount and balance change as a decimal string', async () => {
    // Every random branch fires; the crypto purchase goes to the BTC wallet
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    let nextId = 1
    const { app, queries } = buildStubServer(demodataRoutes, [
      { match: /SELECT 1 FROM accounts/, rows: () => [] },
      { match: /RETURNING id/, rows: () => [{ id: nextId++ }] },
      { match: /FROM exchange_rates/, rows: () => [{ from_currency: 'BTC', to_currency: 'USD', rate: '65000' }] },
      { match: /SELECT id FROM (categories|tags)/, rows: () => [{ id: 1 }] },
      { match: /SELECT CURRENT_DATE::text AS today/, rows: () => [{ today: '2026-03-05' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/admin/load-demo' })
    expect(res.statusCode).toBe(200)

    const accountInserts = queries.filter(q => q.sql.startsWith('INSERT INTO accounts'))
    expect(accountInserts.map(q => q.params[4])).toEqual(['1250.50', '150.00', '5000.00', '0.05', '0.5'])

    const txInserts = queries.filter(q => q.sql.startsWith('INSERT INTO transactions'))
    const balanceUpdates = queries.filter(q => q.sql.startsWith('UPDATE accounts SET balance'))
    expect(txInserts.length).toBeGreaterThan(0)
    expect(balanceUpdates).toHaveLength(txInserts.length)
    for (const q of txInserts) expect(q.params[3]).toMatch(NUMERIC)
    for (const q of balanceUpdates) expect(q.params[0]).toMatch(NUMERIC)

    // 599.50 USD at 65000 USD/BTC, kept to the 12 decimals the column holds
    expect(txInserts.map(q => q.params[3])).toContain('0.009223076923')
    // The BTC staking reward keeps satoshi steps instead of float noise
    expect(txInserts.map(q => q.params[3])).toContain('0.00109900')
  })
})
