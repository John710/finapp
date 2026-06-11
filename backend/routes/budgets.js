import { loadRates, convertAmount } from '../services/currency.js'

async function budgetRoutes(fastify, opts) {
  // List with progress — spent is converted into the budget's currency using live rates
  fastify.get('/budgets', async (request, reply) => {
    const [budgetsResult, rates] = await Promise.all([
      fastify.db.query(`
        SELECT b.*, c.name as category_name, c.color as category_color
        FROM budgets b
        LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.is_active = true
        ORDER BY b.created_at DESC
      `),
      loadRates(fastify.db)
    ])

    const budgets = budgetsResult.rows
    if (budgets.length === 0) return []

    // Fetch all relevant transactions with their account currencies in one query
    const txResult = await fastify.db.query(`
      SELECT t.amount, a.currency as account_currency, b.id as budget_id, b.currency as budget_currency
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN budgets b ON b.category_id = t.category_id
      WHERE t.type = 'expense'
        AND t.date >= b.start_date
        AND t.date < CASE WHEN b.period = 'month' THEN b.start_date + INTERVAL '1 month' ELSE b.start_date + INTERVAL '7 days' END
        AND b.is_active = true
    `)

    const spentByBudget = {}
    for (const tx of txResult.rows) {
      const amount = parseFloat(tx.amount)
      const fromCurrency = tx.account_currency
      const toCurrency = tx.budget_currency
      const converted = fromCurrency === toCurrency
        ? amount
        : convertAmount(amount, fromCurrency, toCurrency, rates)

      if (converted === null) {
        fastify.log.warn(`Budget spent conversion failed: ${fromCurrency} -> ${toCurrency} for budget ${tx.budget_id}`)
      }

      const value = converted !== null ? converted : amount
      spentByBudget[tx.budget_id] = (spentByBudget[tx.budget_id] || 0) + value
    }

    return budgets.map(b => {
      const spent = spentByBudget[b.id] || 0
      const amount = parseFloat(b.amount)
      return {
        ...b,
        spent,
        progress: amount > 0 ? Math.round((spent / amount) * 100) : 0
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
          amount: { type: 'number', minimum: 0 },
          currency: { type: 'string' },
          period: { type: 'string', enum: ['month', 'week'] },
          start_date: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { category_id, amount, currency, period, start_date } = request.body
    const result = await fastify.db.query(
      'INSERT INTO budgets (category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [category_id, amount, currency || 'USD', period, start_date || new Date().toISOString().split('T')[0]]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/budgets/:id', async (request, reply) => {
    const { id } = request.params
    const { category_id, amount, currency, period, start_date, is_active } = request.body
    const result = await fastify.db.query(
      'UPDATE budgets SET category_id = $1, amount = $2, currency = $3, period = $4, start_date = $5, is_active = $6 WHERE id = $7 RETURNING *',
      [category_id, amount, currency, period, start_date, is_active, id]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Budget not found' }
    }
    return result.rows[0]
  })

  // Delete
  fastify.delete('/budgets/:id', async (request, reply) => {
    const { id } = request.params
    await fastify.db.query('DELETE FROM budgets WHERE id = $1', [id])
    reply.code(204)
  })
}

export default budgetRoutes
