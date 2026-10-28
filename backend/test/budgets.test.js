import { describe, it, expect } from 'vitest'
import budgetRoutes from '../routes/budgets.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

const statements = (queries, re) => queries.filter(q => re.test(q.sql))

describe('GET /budgets', () => {
  function buildServer() {
    return buildStubServer(budgetRoutes, [
      { match: /FROM budgets b\s+LEFT JOIN categories/, rows: () => [{ id: 4, user_id: 1, amount: '100', currency: 'USD', period: 'month' }] },
      // the spending query also mentions budget_tags (tag targets), so it goes first
      { match: /FROM budgets b\s+JOIN transactions t/, rows: () => [{ amount: '25', account_currency: 'USD', budget_id: 4, budget_currency: 'USD' }] },
      { match: /FROM budget_tags bt/, rows: () => [{ budget_id: 4, id: 8, name: 'Food', color: '#fff' }] }
    ])
  }

  it('lists a shared budget with its owner\'s spending and global tags', async () => {
    const { app, queries } = buildServer()
    const res = await app.inject({ method: 'GET', url: '/budgets' })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0]).toMatchObject({ id: 4, spent: 25, progress: 25, tags: [{ id: 8, name: 'Food', color: '#fff' }] })

    const [list] = statements(queries, /FROM budgets b\s+LEFT JOIN categories/)
    expect(list.sql).not.toMatch(/LEFT JOIN entity_shares/)
    expect(list.sql).toContain('EXISTS')

    // tags have no user_id since migration 29
    const [tags] = statements(queries, /^SELECT bt\.budget_id/)
    expect(tags.sql).not.toContain('user_id')
    expect(tags.params).toEqual([[4]])

    // spending is scoped by the visible budgets, not by the viewer's accounts
    const [spent] = statements(queries, /FROM budgets b\s+JOIN transactions t/)
    expect(spent.sql).not.toContain('a.user_id')
    expect(spent.sql).toContain('b.id = ANY($1)')
    expect(spent.params).toEqual([[4]])
  })
})

describe('PUT /budgets/:id', () => {
  it('keeps currency, start_date and is_active when the body omits them', async () => {
    const { app, queries } = buildStubServer(budgetRoutes, [
      { match: /FROM categories/, rows: () => [{ id: 2 }] },
      { match: /UPDATE budgets/, rows: () => [{ id: 4 }] }
    ])
    const res = await app.inject({ method: 'PUT', url: '/budgets/4', payload: { category_id: 2, amount: 50, period: 'month' } })
    expect(res.statusCode).toBe(200)
    const [update] = statements(queries, /UPDATE budgets/)
    expect(update.sql).toContain('currency = COALESCE($3, currency)')
    expect(update.sql).toContain('start_date = COALESCE($5, start_date)')
    expect(update.sql).toContain('is_active = COALESCE($6, is_active)')
    expect(update.params).toEqual([2, 50, null, 'month', null, null, 4, USER])
  })
})

describe('DELETE /budgets/:id', () => {
  it('deletes the owner\'s shares only after the owned delete, in one transaction', async () => {
    const { app, queries } = buildStubServer(budgetRoutes, [
      { match: /DELETE FROM budgets/, rows: () => [{ id: 4 }] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/budgets/4' })
    expect(res.statusCode).toBe(204)
    const order = queries.map(q => q.sql).filter(sql => /^(BEGIN|COMMIT|DELETE)/.test(sql))
    expect(order).toHaveLength(4)
    expect(order[0]).toBe('BEGIN')
    expect(order[1]).toMatch(/^DELETE FROM budgets WHERE id = \$1 AND user_id = \$2/)
    expect(order[2]).toMatch(/^DELETE FROM entity_shares .*owner_id = \$2/)
    expect(order[3]).toBe('COMMIT')
  })

  it('does not touch shares of a budget the caller does not own', async () => {
    const { app, queries } = buildStubServer(budgetRoutes, [])
    const res = await app.inject({ method: 'DELETE', url: '/budgets/4' })
    expect(res.statusCode).toBe(404)
    expect(statements(queries, /entity_shares/)).toHaveLength(0)
  })
})
