import { findTransferLeg } from './transactions.js'

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
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['name', 'type', 'currency'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['card', 'cash', 'crypto', 'other', 'goal'] },
          currency: { type: 'string', minLength: 1, maxLength: 10 },
          balance: { type: 'number' },
          color: { type: 'string', maxLength: 32 },
          icon: { type: 'string', maxLength: 100000 },
          is_archived: { type: 'boolean' },
          target_amount: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const body = request.body
    // Build SET dynamically so omitted optional fields keep their stored values
    // instead of being overwritten with NULL.
    const fields = []
    const values = []
    let idx = 1
    for (const key of ['name', 'type', 'currency', 'balance', 'color', 'icon', 'is_archived', 'target_amount']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`)
        values.push(body[key])
      }
    }
    if (fields.length === 0) {
      reply.code(400)
      return { error: 'No fields to update' }
    }
    fields.push('updated_at = NOW()')
    values.push(id, userId)
    const result = await fastify.db.query(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      values
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
  fastify.delete('/accounts/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      const accRes = await client.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, userId])
      if (accRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: 'Account not found' }
      }

      // Transfers OUT of this account credited other accounts — take the
      // credited amount (the paired leg amount, in the TARGET currency) back.
      const outgoing = await client.query(
        "SELECT * FROM transactions WHERE account_id = $1 AND user_id = $2 AND type = 'transfer' AND transfer_to_account_id IS NOT NULL",
        [id, userId]
      )
      for (const tx of outgoing.rows) {
        const leg = await findTransferLeg(client, tx)
        const credited = leg ? parseFloat(leg.amount) : parseFloat(tx.amount)
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [credited, tx.transfer_to_account_id, userId]
        )
      }

      // Transfers INTO this account deducted other accounts — give the money
      // back before their source rows are removed together with the account.
      const incoming = await client.query(
        "SELECT * FROM transactions WHERE transfer_to_account_id = $1 AND user_id = $2 AND account_id != $1 AND type = 'transfer'",
        [id, userId]
      )
      for (const tx of incoming.rows) {
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [parseFloat(tx.amount), tx.account_id, userId]
        )
      }

      // transaction_tags rows cascade via FK; remove every transaction that
      // lives on this account or references it as a transfer counterparty.
      await client.query(
        'DELETE FROM transactions WHERE (account_id = $1 OR transfer_to_account_id = $1) AND user_id = $2',
        [id, userId]
      )
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
