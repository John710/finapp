async function recurringRoutes(fastify, opts) {
  // List
  fastify.get('/recurring', async (request, reply) => {
    const userId = request.user.userId
    const result = await fastify.db.query(`
      SELECT r.*, a.name as account_name, c.name as category_name
      FROM recurring_rules r
      LEFT JOIN accounts a ON a.id = r.account_id AND a.user_id = $1
      LEFT JOIN categories c ON c.id = r.category_id AND c.user_id = $1
      WHERE r.user_id = $1
      ORDER BY r.next_date ASC
    `, [userId])
    return result.rows
  })

  // Create
  fastify.post('/recurring', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type', 'frequency', 'next_date'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', minimum: 0 },
          currency: { type: 'string' },
          type: { type: 'string', enum: ['income', 'expense'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          next_date: { type: 'string' },
          note: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { account_id, category_id, amount, currency, type, frequency, next_date, note } = request.body
    const result = await fastify.db.query(
      'INSERT INTO recurring_rules (user_id, account_id, category_id, amount, currency, type, frequency, next_date, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [userId, account_id, category_id, amount, currency || 'USD', type, frequency, next_date, note]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/recurring/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type', 'frequency', 'next_date'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', minimum: 0 },
          currency: { type: 'string' },
          type: { type: 'string', enum: ['income', 'expense'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          next_date: { type: 'string' },
          note: { type: 'string' },
          is_active: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const { account_id, category_id, amount, currency, type, frequency, next_date, note, is_active } = request.body
    const result = await fastify.db.query(
      'UPDATE recurring_rules SET account_id = $1, category_id = $2, amount = $3, currency = $4, type = $5, frequency = $6, next_date = $7, note = $8, is_active = $9 WHERE id = $10 AND user_id = $11 RETURNING *',
      [account_id, category_id, amount, currency, type, frequency, next_date, note, is_active, id, userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Rule not found' }
    }
    return result.rows[0]
  })

  // Delete
  fastify.delete('/recurring/:id', async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    await fastify.db.query('DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2', [id, userId])
    reply.code(204)
  })
}

export default recurringRoutes
