import { describe, it, expect } from 'vitest'
import transactionRoutes from '../routes/transactions.js'
import { buildStubServer, pgError, TEST_USER as USER } from './helpers/stub-db.js'

// An auto-transaction keeps its recurring_rule_id, and
// 0000000000032_recurring_occurrence_integrity.js makes (recurring_rule_id, date)
// unique. Moving such a transaction onto a date the schedule already paid hits
// that constraint, so the route must answer with a readable 400 instead of the
// 500 an unmapped driver error would produce.

const OCCURRENCY_UNIQ = 'transactions_recurring_occ_uniq'

const autoTx = {
  id: 4,
  user_id: USER,
  account_id: 3,
  category_id: null,
  amount: '31.500000000000',
  type: 'expense',
  date: '2026-03-31',
  note: 'Rent',
  recurring_rule_id: 1,
  is_split: false,
  parent_id: null,
  transfer_pair_id: null,
  transfer_to_account_id: null
}

const ownAccount = { id: 3, owner_id: USER, currency: 'USD', type: 'checking', access: 'own' }

function buildServer(extra = []) {
  return buildStubServer(transactionRoutes, [
    { match: /SELECT language FROM users/, rows: () => [{ language: 'en' }] },
    { match: /FROM transactions WHERE id = \$1 FOR UPDATE/, rows: () => [autoTx] },
    { match: /FROM accounts a WHERE a.id/, rows: () => [ownAccount] },
    ...extra
  ])
}

const movePayload = { account_id: 3, amount: 31.5, type: 'expense', date: '2026-04-15' }

function put(app, payload = movePayload) {
  return app.inject({ method: 'PUT', url: '/transactions/4', payload })
}

describe('PUT /transactions/:id and the occurrence index', () => {
  it('answers a localized 400 when the schedule already holds that date', async () => {
    const { app, queries } = buildServer([
      {
        match: /UPDATE transactions SET/,
        throws: () => pgError('23505', OCCURRENCY_UNIQ)
      }
    ])
    const res = await put(app)
    expect(res.statusCode).toBe(400)
    // Fastify puts schema rejections in `validation`; this error comes from the route.
    expect(res.json().validation).toBeUndefined()
    expect(res.json().error).toBeTruthy()
    expect(queries.some(q => /ROLLBACK/.test(q.sql))).toBe(true)
    expect(queries.some(q => /COMMIT/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('leaves an unrelated unique conflict to the generic error handler', async () => {
    const { app } = buildServer([
      {
        match: /UPDATE transactions SET/,
        throws: () => pgError('23505', 'transactions_pkey')
      }
    ])
    const res = await put(app)
    expect(res.statusCode).toBe(500)
    await app.close()
  })

  it('keeps other driver errors unmapped', async () => {
    const { app } = buildServer([
      {
        match: /UPDATE transactions SET/,
        throws: () => {
          const err = new Error('value too long')
          err.code = '22001'
          return err
        }
      }
    ])
    const res = await put(app)
    expect(res.statusCode).toBe(500)
    await app.close()
  })

  it('still updates the row when no constraint is hit', async () => {
    const { app, queries } = buildServer([
      { match: /UPDATE transactions SET/, rows: () => [{ ...autoTx, date: '2026-04-15' }] }
    ])
    const res = await put(app)
    expect(res.statusCode).toBe(200)
    expect(res.json().date).toBe('2026-04-15')
    expect(queries.some(q => /COMMIT/.test(q.sql))).toBe(true)
    await app.close()
  })
})
