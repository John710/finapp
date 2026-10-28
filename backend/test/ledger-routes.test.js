import { describe, it, expect } from 'vitest'
import transactionRoutes from '../routes/transactions.js'
import categoryRoutes from '../routes/categories.js'
import tagRoutes from '../routes/tags.js'
import accountRoutes from '../routes/accounts.js'
import { visibleAccountIds, editableSharedAccountIds } from '../services/visibility.js'
import {
  buildStubDb,
  buildStubServer,
  highestPlaceholder,
  takeBindViolations,
  TEST_USER as USER
} from './helpers/stub-db.js'

// Contract of the ledger core routes (transactions, categories, tags, accounts)
// on the recording stub db. The stub rejects any statement whose bind array does
// not match its highest $n — the 08P01 PostgreSQL raises in production.

const OTHER = 8
const LANG = { match: /SELECT language FROM users/, rows: () => [{ language: 'en' }] }
const ownAccount = { id: 3, owner_id: USER, currency: 'USD', type: 'card', access: 'own' }

const findQuery = (queries, re) => queries.find(q => re.test(q.sql))
const findQueries = (queries, re) => queries.filter(q => re.test(q.sql))

describe('stub db bind guard', () => {
  it('finds the highest placeholder', () => {
    expect(highestPlaceholder('SELECT 1')).toBe(0)
    expect(highestPlaceholder('SELECT $2, $10, $1')).toBe(10)
  })

  it('rejects extra bind values like PostgreSQL does', async () => {
    const { db } = buildStubDb()
    await expect(db.query('SELECT id FROM categories WHERE id = $1', [5, USER]))
      .rejects.toMatchObject({ code: '08P01' })
    expect(takeBindViolations()).toHaveLength(1)
  })
})

function txServer(extra = [], opts) {
  return buildStubServer(transactionRoutes, [
    LANG,
    { match: /FROM accounts a WHERE a.id/, rows: () => [ownAccount] },
    { match: /SELECT id FROM categories WHERE id = \$1/, rows: () => [{ id: 5 }] },
    { match: /INSERT INTO transactions .* RETURNING \*/, rows: () => [{ id: 10, user_id: USER, account_id: 3 }] },
    ...extra
  ], opts)
}

describe('POST /transactions', () => {
  it('creates a categorized expense with one bind value per placeholder', async () => {
    const { app, queries } = txServer()
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { account_id: 3, category_id: 5, amount: 12.34, type: 'expense', date: '2026-03-05' }
    })
    expect(res.statusCode).toBe(201)
    expect(findQuery(queries, /FROM categories WHERE id = \$1/).params).toEqual([5])
    // Balance delta is an exact decimal string, not a float product
    expect(findQuery(queries, /UPDATE accounts SET balance = balance \+/).params).toEqual(['-12.34', 3, USER])
    expect(queries.some(q => q.sql === 'COMMIT')).toBe(true)
    await app.close()
  })

  it('looks up budgets without the dropped categories.user_id column', async () => {
    const { app, queries } = txServer()
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { account_id: 3, category_id: 5, amount: 10, type: 'expense', date: '2026-03-05' }
    })
    const budget = findQuery(queries, /FROM budgets b/)
    expect(budget).toBeTruthy()
    expect(budget.sql).not.toMatch(/c\.user_id/)
    await app.close()
  })

  it('creates a split whose parts sum exactly to the total', async () => {
    const { app, queries } = txServer()
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        account_id: 3, amount: 0.3, type: 'expense', date: '2026-03-05',
        splits: [{ category_id: 5, amount: 0.1 }, { category_id: 6, amount: 0.2 }]
      }
    })
    expect(res.statusCode).toBe(201)
    expect(findQueries(queries, /SELECT id FROM categories WHERE id = \$1/).map(q => q.params)).toEqual([[5], [6]])
    expect(findQueries(queries, /INSERT INTO transactions .*parent_id/)).toHaveLength(2)
    await app.close()
  })

  it('rejects split parts that are off by less than half a cent', async () => {
    const { app, queries } = txServer()
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        account_id: 3, amount: 100, type: 'expense', date: '2026-03-05',
        splits: [{ category_id: 5, amount: 50 }, { category_id: 6, amount: 49.996 }]
      }
    })
    expect(res.statusCode).toBe(400)
    expect(queries.some(q => /INSERT INTO transactions/.test(q.sql))).toBe(false)
    await app.close()
  })
})

describe('GET /transactions', () => {
  it('counts exactly the rows the list pages through', async () => {
    const { app, queries } = txServer([
      { match: /SELECT id FROM accounts WHERE user_id/, rows: () => [{ id: 3 }] },
      { match: /SELECT COUNT\(\*\)/, rows: () => [{ count: '0' }] }
    ])
    const res = await app.inject({ method: 'GET', url: '/transactions?category_id=5' })
    expect(res.statusCode).toBe(200)
    const count = findQuery(queries, /SELECT COUNT\(\*\)/).sql
    const list = findQuery(queries, /SELECT t\.\*/).sql
    const countWhere = count.slice(count.indexOf('WHERE'))
    const listWhere = list.slice(list.indexOf('WHERE'), list.indexOf(' ORDER BY'))
    expect(countWhere).toBe(listWhere)
    await app.close()
  })
})

// A transfer from own account 3 to account 9 owned by OTHER; its paired leg
// (id 11) sits on account 9 and belongs to OTHER.
const transferTx = {
  id: 4,
  user_id: USER,
  account_id: 3,
  category_id: null,
  amount: '50.000000000000',
  type: 'transfer',
  date: '2026-03-05',
  note: null,
  is_split: false,
  parent_id: null,
  transfer_pair_id: 11,
  transfer_to_account_id: 9
}
const transferLeg = { id: 11, amount: '4625.000000000000', type: 'income', user_id: OTHER }

function transferServer(counterAccess) {
  return buildStubServer(transactionRoutes, [
    LANG,
    { match: /FROM transactions WHERE id = \$1 FOR UPDATE/, rows: () => [transferTx] },
    { match: /SELECT id, amount, type, user_id FROM transactions WHERE id = \$1/, rows: () => [transferLeg] },
    {
      match: /FROM accounts a WHERE a.id/,
      rows: params => params[1] === 9
        ? [{ id: 9, owner_id: OTHER, currency: 'RUB', type: 'card', access: counterAccess }]
        : [ownAccount]
    }
  ])
}

describe('transfer legs need write access to the counter account', () => {
  it('DELETE answers 403 when the counter account is only viewable', async () => {
    const { app, queries } = transferServer('view')
    const res = await app.inject({ method: 'DELETE', url: '/transactions/4' })
    expect(res.statusCode).toBe(403)
    expect(queries.some(q => /UPDATE accounts|DELETE FROM transactions/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('PUT answers 403 when the counter account is only viewable', async () => {
    const { app, queries } = transferServer('view')
    const res = await app.inject({
      method: 'PUT',
      url: '/transactions/4',
      payload: { account_id: 3, amount: 20, type: 'expense', date: '2026-03-05' }
    })
    expect(res.statusCode).toBe(403)
    expect(queries.some(q => /UPDATE accounts|DELETE FROM transactions/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('DELETE reverts both legs with exact amounts when both accounts are writable', async () => {
    const { app, queries } = transferServer('edit')
    const res = await app.inject({ method: 'DELETE', url: '/transactions/4' })
    expect(res.statusCode).toBe(204)
    const reverts = findQueries(queries, /UPDATE accounts SET balance = balance -/).map(q => q.params)
    expect(reverts).toEqual([['-50', 3, USER], ['4625.000000000000', 9, OTHER]])
    await app.close()
  })
})

function catalogServer(routes, role, extra = []) {
  return buildStubServer(routes, [LANG, ...extra], { role })
}

describe('global categories: only admins change them', () => {
  const twoCategories = {
    match: /SELECT id, type, name FROM categories WHERE id IN/,
    rows: () => [{ id: 1, type: 'expense', name: 'Food' }, { id: 2, type: 'expense', name: 'Groceries' }]
  }

  it('lets any user create a category', async () => {
    const { app } = catalogServer(categoryRoutes, 'user', [
      { match: /INSERT INTO categories/, rows: () => [{ id: 3, name: 'Pets' }] }
    ])
    const res = await app.inject({ method: 'POST', url: '/categories', payload: { name: 'Pets', type: 'expense' } })
    expect(res.statusCode).toBe(201)
    await app.close()
  })

  it('refuses update, delete and merge to a non-admin with 403', async () => {
    const { app, queries } = catalogServer(categoryRoutes, 'user', [twoCategories])
    const calls = [
      { method: 'PUT', url: '/categories/1', payload: { name: 'X', type: 'expense' } },
      { method: 'DELETE', url: '/categories/1' },
      { method: 'POST', url: '/categories/1/merge', payload: { target_id: 2 } }
    ]
    for (const call of calls) {
      const res = await app.inject(call)
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toMatch(/administrator/)
    }
    expect(queries.some(q => /UPDATE|DELETE|INSERT/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('lets an admin delete a category', async () => {
    const { app } = catalogServer(categoryRoutes, 'admin', [
      { match: /DELETE FROM categories/, rows: () => [{}] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/categories/1' })
    expect(res.statusCode).toBe(204)
    await app.close()
  })

  it('merges for an admin with exact bind arrays and per-user budget clashes', async () => {
    const { app, queries } = catalogServer(categoryRoutes, 'admin', [twoCategories])
    const res = await app.inject({ method: 'POST', url: '/categories/1/merge', payload: { target_id: 2 } })
    expect(res.statusCode).toBe(204)
    expect(findQuery(queries, /FROM categories WHERE id IN/).params).toEqual([1, 2])
    const clash = findQuery(queries, /DELETE FROM budgets/)
    expect(clash.sql).toMatch(/tb\.user_id = b\.user_id/)
    expect(clash.params).toEqual([1, 2])
    expect(findQuery(queries, /UPDATE transactions SET category_id/).params).toEqual([2, 1])
    expect(queries.some(q => q.sql === 'COMMIT')).toBe(true)
    await app.close()
  })
})

describe('global tags: only admins change them', () => {
  it('refuses update and delete to a non-admin with 403', async () => {
    const { app, queries } = catalogServer(tagRoutes, 'user')
    for (const call of [
      { method: 'PUT', url: '/tags/1', payload: { name: 'x' } },
      { method: 'DELETE', url: '/tags/1' }
    ]) {
      const res = await app.inject(call)
      expect(res.statusCode).toBe(403)
    }
    expect(queries.some(q => /UPDATE|DELETE/.test(q.sql))).toBe(false)
    await app.close()
  })

  it('counts tag usage only on accounts the caller can see', async () => {
    const { app, queries } = catalogServer(tagRoutes, 'user', [
      { match: /SELECT id FROM accounts WHERE user_id/, rows: () => [{ id: 3 }, { id: 9 }] },
      { match: /FROM tags t/, rows: () => [{ id: 1, name: 'trip', transaction_count: 2 }] }
    ])
    const res = await app.inject({ method: 'GET', url: '/tags' })
    expect(res.statusCode).toBe(200)
    const list = findQuery(queries, /FROM tags t/)
    expect(list.sql).toMatch(/account_id = ANY\(\$1\)/)
    expect(list.params).toEqual([[3, 9]])
    await app.close()
  })
})

describe('DELETE /accounts/:id balance compensation', () => {
  it('sums every transfer per counterparty before updating balances', async () => {
    const { app, queries } = buildStubServer(accountRoutes, [
      LANG,
      { match: /SELECT id FROM accounts WHERE id = \$1 AND user_id = \$2/, rows: () => [{ id: 3 }] }
    ])
    const res = await app.inject({ method: 'DELETE', url: '/accounts/3' })
    expect(res.statusCode).toBe(204)
    const updates = findQueries(queries, /^UPDATE accounts a SET balance/)
    expect(updates).toHaveLength(3)
    for (const u of updates) {
      // UPDATE ... FROM applies one joined row per target: the source rows must
      // be aggregated in a subquery, never joined directly.
      expect(u.sql).toMatch(/FROM \( SELECT .*SUM\(.*GROUP BY .*\) agg WHERE a\.id = agg\.account_id/)
      expect(u.params).toEqual([3, USER])
    }
    await app.close()
  })
})

describe('GET /accounts', () => {
  it('resolves one share row per account', async () => {
    const { app, queries } = buildStubServer(accountRoutes, [])
    const res = await app.inject({ method: 'GET', url: '/accounts' })
    expect(res.statusCode).toBe(200)
    const sql = queries[0].sql
    expect(sql).toMatch(/LEFT JOIN LATERAL \( SELECT es\.permission .* LIMIT 1 \) share/)
    expect(sql).not.toMatch(/LEFT JOIN entity_shares/)
    await app.close()
  })
})

describe('visibility helpers', () => {
  it('only honour shares whose owner still owns the account', async () => {
    const { db, queries } = buildStubDb()
    await visibleAccountIds(db, USER)
    await editableSharedAccountIds(db, USER)
    for (const q of queries) expect(q.sql).toMatch(/a\.user_id = es\.owner_id/)
  })
})
