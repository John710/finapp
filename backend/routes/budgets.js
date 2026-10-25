import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal } from '../services/currency.js'
import { t, getUserLang } from '../services/i18n.js'

async function budgetRoutes(fastify, opts) {
  // List with progress — spent is converted into the budget's currency using live rates
  fastify.get('/budgets', async (request, reply) => {
    const userId = request.user.userId
    const [budgetsResult, rates] = await Promise.all([
      fastify.db.query(`
        SELECT b.*, c.name as category_name, c.color as category_color,
               CASE WHEN b.user_id = $1 THEN NULL ELSE ou.login END AS owner_login,
               CASE WHEN b.user_id = $1 THEN COALESCE((SELECT true FROM entity_shares es3 WHERE es3.entity_type = 'budget' AND es3.entity_id = b.id AND es3.owner_id = b.user_id LIMIT 1), false) ELSE false END AS is_shared
        FROM budgets b
        LEFT JOIN categories c ON c.id = b.category_id
        JOIN users ou ON ou.id = b.user_id
        LEFT JOIN entity_shares es ON es.entity_type = 'budget' AND es.entity_id = b.id
          AND es.owner_id = b.user_id AND (es.shared_with = $1 OR es.shared_with IS NULL)
        WHERE b.is_active = true AND (b.user_id = $1 OR es.id IS NOT NULL)
        ORDER BY b.created_at DESC
      `, [userId]),
      loadRates(fastify.db)
    ])

    const budgets = budgetsResult.rows
    if (budgets.length === 0) return []

    // Attach tag targets (a budget matches its category OR any of its tags)
    const tagsRes = await fastify.db.query(
      `SELECT bt.budget_id, tg.id, tg.name, tg.color
       FROM budget_tags bt
       JOIN tags tg ON tg.id = bt.tag_id AND tg.user_id = $1
       WHERE bt.budget_id = ANY($2)`,
      [userId, budgets.map(b => b.id)]
    )
    const tagsByBudget = {}
    for (const row of tagsRes.rows) {
      if (!tagsByBudget[row.budget_id]) tagsByBudget[row.budget_id] = []
      tagsByBudget[row.budget_id].push({ id: row.id, name: row.name, color: row.color })
    }

    // Fetch all relevant transactions with their account currencies in one query.
    // The spending window always covers the CURRENT period (rolling), so a
    // budget created months ago still shows live progress instead of freezing
    // after its first period elapsed. Split children carry the categories;
    // split parents are excluded to avoid double counting.
    const txResult = await fastify.db.query(`
      SELECT t.amount, a.currency as account_currency, b.id as budget_id, b.currency as budget_currency
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
      JOIN budgets b ON b.user_id = t.user_id
        AND (
          (b.category_id IS NOT NULL AND b.category_id = t.category_id)
          OR EXISTS (
            SELECT 1 FROM budget_tags bt
            JOIN transaction_tags tt ON tt.tag_id = bt.tag_id AND tt.transaction_id = t.id
            WHERE bt.budget_id = b.id
          )
        )
      WHERE t.type = 'expense'
        AND NOT t.is_split
        AND b.user_id IN (
          SELECT b2.user_id FROM budgets b2
          LEFT JOIN entity_shares es2 ON es2.entity_type = 'budget' AND es2.entity_id = b2.id
            AND es2.owner_id = b2.user_id AND (es2.shared_with = $1 OR es2.shared_with IS NULL)
          WHERE b2.is_active = true AND (b2.user_id = $1 OR es2.id IS NOT NULL)
        )
        AND t.date >= CASE WHEN b.period = 'week' THEN date_trunc('week', CURRENT_DATE) ELSE date_trunc('month', CURRENT_DATE) END
        AND t.date < CASE WHEN b.period = 'week' THEN date_trunc('week', CURRENT_DATE) + INTERVAL '7 days' ELSE date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' END
        AND b.is_active = true
    `, [userId])

    const spentByBudget = {}
    for (const tx of txResult.rows) {
      const converted = convertAmountDecimal(tx.amount, tx.account_currency, tx.budget_currency, rates)
      if (converted === null) {
        fastify.log.warn(`Budget spent conversion failed: ${tx.account_currency} -> ${tx.budget_currency} for budget ${tx.budget_id}`)
      }
      const value = converted !== null ? converted : new Decimal(tx.amount)
      spentByBudget[tx.budget_id] = (spentByBudget[tx.budget_id] || new Decimal(0)).plus(value)
    }

    return budgets.map(b => {
      const spent = spentByBudget[b.id] || new Decimal(0)
      const amount = new Decimal(b.amount)
      return {
        ...b,
        tags: tagsByBudget[b.id] || [],
        spent: spent.toNumber(),
        progress: amount.gt(0) ? Math.round(spent.div(amount).times(100).toNumber()) : 0
      }
    })
  })

  // Create
  fastify.post('/budgets', {
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'period'],
        properties: {
          category_id: { type: ['integer', 'null'] },
          tag_ids: { type: 'array', items: { type: 'integer' }, maxItems: 20 },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          period: { type: 'string', enum: ['month', 'week'] },
          start_date: { type: 'string', format: 'date' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { category_id, tag_ids, amount, currency, period, start_date } = request.body
    if (!category_id && !(tag_ids && tag_ids.length)) {
      reply.code(400)
      return { error: t('errors.budget_target_required', {}, lang) }
    }
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      if (category_id) {
        const catRes = await client.query('SELECT id FROM categories WHERE id = $1', [category_id])
        if (catRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.category_not_found', {}, lang) }
        }
      }
      if (tag_ids && tag_ids.length) {
        const tagRes = await client.query('SELECT id FROM tags WHERE id = ANY($1)', [tag_ids])
        if (tagRes.rows.length !== tag_ids.length) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.invalid_tags', {}, lang) }
        }
      }
      const result = await client.query(
        'INSERT INTO budgets (user_id, category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [userId, category_id || null, amount, currency || 'USD', period, start_date || new Date().toISOString().split('T')[0]]
      )
      const budget = result.rows[0]
      for (const tagId of tag_ids || []) {
        await client.query('INSERT INTO budget_tags (budget_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [budget.id, tagId])
      }
      await client.query('COMMIT')
      reply.code(201)
      return budget
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Update
  fastify.put('/budgets/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['amount', 'period'],
        properties: {
          category_id: { type: ['integer', 'null'] },
          tag_ids: { type: 'array', items: { type: 'integer' }, maxItems: 20 },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          period: { type: 'string', enum: ['month', 'week'] },
          start_date: { type: 'string', format: 'date' },
          is_active: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { category_id, tag_ids, amount, currency, period, start_date, is_active } = request.body
    if (!category_id && !(tag_ids && tag_ids.length)) {
      reply.code(400)
      return { error: t('errors.budget_target_required', {}, lang) }
    }
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      if (category_id) {
        const catRes = await client.query('SELECT id FROM categories WHERE id = $1', [category_id])
        if (catRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.category_not_found', {}, lang) }
        }
      }
      if (tag_ids && tag_ids.length) {
        const tagRes = await client.query('SELECT id FROM tags WHERE id = ANY($1)', [tag_ids])
        if (tagRes.rows.length !== tag_ids.length) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.invalid_tags', {}, lang) }
        }
      }
      const result = await client.query(
        'UPDATE budgets SET category_id = $1, amount = $2, currency = $3, period = $4, start_date = $5, is_active = $6 WHERE id = $7 AND user_id = $8 RETURNING *',
        [category_id || null, amount, currency, period, start_date, is_active, id, userId]
      )
      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.budget_not_found', {}, lang) }
      }
      await client.query('DELETE FROM budget_tags WHERE budget_id = $1', [id])
      for (const tagId of tag_ids || []) {
        await client.query('INSERT INTO budget_tags (budget_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tagId])
      }
      await client.query('COMMIT')
      return result.rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Delete
  fastify.delete('/budgets/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    await fastify.db.query("DELETE FROM entity_shares WHERE entity_type = 'budget' AND entity_id = $1", [id])
    const result = await fastify.db.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, userId])
    if (result.rowCount === 0) {
      reply.code(404)
      return { error: t('errors.budget_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default budgetRoutes
