async function accountRoutes(fastify, opts) {
  // List
  fastify.get('/accounts', async (request, reply) => {
    const result = await fastify.db.query(
      'SELECT * FROM accounts ORDER BY is_archived, sort_order, created_at DESC'
    )
    return result.rows
  })

  // Create
  fastify.post('/accounts', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'currency'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['card', 'cash', 'crypto', 'other', 'goal'] },
          currency: { type: 'string', minLength: 1, maxLength: 10 },
          target_amount: { type: 'number' },
          balance: { type: 'number' },
          color: { type: 'string' },
          icon: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { name, type, currency, balance, color, icon, target_amount } = request.body
    // New accounts go to the end of their type group
    const maxResult = await fastify.db.query(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM accounts WHERE type = $1',
      [type]
    )
    const sort_order = (parseInt(maxResult.rows[0].max_order) || 0) + 1
    const result = await fastify.db.query(
      'INSERT INTO accounts (name, type, currency, balance, color, icon, target_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [name, type, currency, balance || 0, color, icon, target_amount || 0, sort_order]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/accounts/:id', async (request, reply) => {
    const { id } = request.params
    const { name, type, currency, balance, color, icon, is_archived, target_amount } = request.body
    const result = await fastify.db.query(
      'UPDATE accounts SET name = $1, type = $2, currency = $3, balance = $4, color = $5, icon = $6, is_archived = $7, target_amount = $8, updated_at = NOW() WHERE id = $9 RETURNING *',
      [name, type, currency, balance, color, icon, is_archived, target_amount, id]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Account not found' }
    }
    return result.rows[0]
  })

  // Reorder accounts within their type
  fastify.post('/accounts/reorder', {
    schema: {
      body: {
        type: 'object',
        required: ['orders'],
        properties: {
          orders: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'sort_order'],
              properties: {
                id: { type: 'integer' },
                sort_order: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { orders } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      for (const item of orders) {
        await client.query(
          'UPDATE accounts SET sort_order = $1, updated_at = NOW() WHERE id = $2',
          [item.sort_order, item.id]
        )
      }
      await client.query('COMMIT')
      return { success: true }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Delete
  fastify.delete('/accounts/:id', async (request, reply) => {
    const { id } = request.params
    await fastify.db.query('DELETE FROM accounts WHERE id = $1', [id])
    reply.code(204)
  })
}

export default accountRoutes
