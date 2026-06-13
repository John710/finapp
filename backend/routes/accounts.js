async function accountRoutes(fastify, opts) {
  // List
  fastify.get('/accounts', async (request, reply) => {
    const userId = request.user.userId
    const result = await fastify.db.query(
      'SELECT * FROM accounts WHERE user_id = $1 ORDER BY is_archived, sort_order, created_at DESC',
      [userId]
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
    const userId = request.user.userId
    const { name, type, currency, balance, color, icon, target_amount } = request.body
    const maxResult = await fastify.db.query(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM accounts WHERE type = $1 AND user_id = $2',
      [type, userId]
    )
    const sort_order = (parseInt(maxResult.rows[0].max_order) || 0) + 1
    const result = await fastify.db.query(
      'INSERT INTO accounts (user_id, name, type, currency, balance, color, icon, target_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [userId, name, type, currency, balance || 0, color, icon, target_amount || 0, sort_order]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/accounts/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'currency'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['card', 'cash', 'crypto', 'other', 'goal'] },
          currency: { type: 'string', minLength: 1, maxLength: 10 },
          balance: { type: 'number' },
          color: { type: 'string' },
          icon: { type: 'string' },
          is_archived: { type: 'boolean' },
          target_amount: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const { name, type, currency, balance, color, icon, is_archived, target_amount } = request.body
    const result = await fastify.db.query(
      'UPDATE accounts SET name = $1, type = $2, currency = $3, balance = $4, color = $5, icon = $6, is_archived = $7, target_amount = $8, updated_at = NOW() WHERE id = $9 AND user_id = $10 RETURNING *',
      [name, type, currency, balance, color, icon, is_archived, target_amount, id, userId]
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
    const userId = request.user.userId
    const { orders } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      for (const item of orders) {
        await client.query(
          'UPDATE accounts SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
          [item.sort_order, item.id, userId]
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
    const userId = request.user.userId
    const { id } = request.params
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      // Revert balances from all transactions involving this account
      const txRes = await client.query(
        'SELECT * FROM transactions WHERE (account_id = $1 OR transfer_to_account_id = $1) AND user_id = $2',
        [id, userId]
      )
      for (const tx of txRes.rows) {
        const sign = tx.type === 'income' ? 1 : -1
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [parseFloat(tx.amount) * sign, tx.account_id, userId]
        )
        if (tx.type === 'transfer' && tx.transfer_to_account_id) {
          await client.query(
            'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
            [parseFloat(tx.amount), tx.transfer_to_account_id, userId]
          )
        }
      }

      await client.query('DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE (account_id = $1 OR transfer_to_account_id = $1) AND user_id = $2)', [id, userId])
      await client.query('DELETE FROM transactions WHERE (account_id = $1 OR transfer_to_account_id = $1) AND user_id = $2', [id, userId])
      await client.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [id, userId])

      await client.query('COMMIT')
      reply.code(204)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}

export default accountRoutes
