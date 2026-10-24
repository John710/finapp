import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal } from '../services/currency.js'
import { t, getUserLang } from '../services/i18n.js'

async function budgetRoutes(fastify, opts) {
  // List with progress — spent is converted into the budget's currency using live rates
  fastify.get('/budgets', async (request, reply) => {
    const userId = request.user.userId
    const [budgetsResult, rates] = await Promise.all([
      fastify.db.query(`
        SELECT b.*, c.name as category_name, c.color as category_color
        FROM budgets b
        LEFT JOIN categories c ON c.id = b.category_id AND c.user_id = $1
        WHERE b.is_active = true AND b.user_id = $1
        ORDER BY b.created_at DESC
      `, [userId]),
      loadRates(fastify.db)
    ])

    const budgets = budgetsResult.rows
    if (budgets.length === 0) return []

    // Fetch all relevant transactions with their account currencies in one query.
    // The spending window always covers the CURRENT period (rolling), so a
    // budget created months ago still shows live progress instead of freezing
    // after its first period elapsed.
    const txResult = await fastify.db.query(`
      SELECT t.amount, a.currency as account_currency, b.id as budget_id, b.currency as budget_currency
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
      JOIN budgets b ON b.category_id = t.category_id AND b.user_id = $1
      WHERE t.type = 'expense'
        AND t.user_id = $1
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
        required: ['category_id', 'amount', 'period'],
        properties: {
          category_id: { type: 'integer' },
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
    const { category_id, amount, currency, period, start_date } = request.body
    const catRes = await fastify.db.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
    if (catRes.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.category_not_found', {}, lang) }
    }
    const result = await fastify.db.query(
      'INSERT INTO budgets (user_id, category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [userId, category_id, amount, currency || 'USD', period, start_date || new Date().toISOString().split('T')[0]]
    )
    reply.code(201)
    return result.rows[0]
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
        required: ['category_id', 'amount', 'period'],
        properties: {
          category_id: { type: 'integer' },
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
    const { category_id, amount, currency, period, start_date, is_active } = request.body
    const catRes = await fastify.db.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
    if (catRes.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.category_not_found', {}, lang) }
    }
    const result = await fastify.db.query(
      'UPDATE budgets SET category_id = $1, amount = $2, currency = $3, period = $4, start_date = $5, is_active = $6 WHERE id = $7 AND user_id = $8 RETURNING *',
      [category_id, amount, currency, period, start_date, is_active, id, userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.budget_not_found', {}, lang) }
    }
    return result.rows[0]
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
    const result = await fastify.db.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, userId])
    if (result.rowCount === 0) {
      reply.code(404)
      return { error: t('errors.budget_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default budgetRoutes
