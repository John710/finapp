import { t, getUserLang } from '../services/i18n.js'

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
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['card', 'cash', 'crypto', 'other', 'goal'] },
          currency: { type: 'string', minLength: 1, maxLength: 10 },
          target_amount: { type: 'number' },
          balance: { type: 'number' },
          color: { type: 'string', maxLength: 32 },
          icon: { type: 'string', maxLength: 100000 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { name, type, currency, balance, color, icon, target_amount } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      // Serialize sort_order computation per user: two parallel POSTs would
      // otherwise read the same MAX(sort_order) and get identical positions.
      await client.query('SELECT pg_advisory_xact_lock($1)', [userId])
      const maxResult = await client.query(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM accounts WHERE type = $1 AND user_id = $2',
        [type, userId]
      )
      const sort_order = (parseInt(maxResult.rows[0].max_order) || 0) + 1
      const result = await client.query(
        'INSERT INTO accounts (user_id, name, type, currency, balance, color, icon, target_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [userId, name, type, currency, balance || 0, color, icon, target_amount || 0, sort_order]
      )
      await client.query('COMMIT')
      reply.code(201)
      return result.rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
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
    const lang = await getUserLang(fastify.db, userId)
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
      return { error: t('errors.no_fields_to_update', {}, lang) }
    }
    fields.push('updated_at = NOW()')
    values.push(id, userId)
    const result = await fastify.db.query(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      values
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.account_not_found', {}, lang) }
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
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      const accRes = await client.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, userId])
      if (accRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.account_not_found', {}, lang) }
      }

      // Transfers OUT of this account credited other accounts — take the
      // credited amount (the paired leg amount, in the TARGET currency) back.
      // Both statements mirror findTransferLeg() semantics: rows linked via
      // transfer_pair_id are matched directly; legacy rows (pair id NULL) fall
      // back to the latest matching income leg, or to the source amount when
      // no leg exists. All arithmetic stays in SQL numeric — no float rounding.
      await client.query(`
        UPDATE accounts a
        SET balance = a.balance - leg.amount
        FROM transactions src
        JOIN transactions leg ON leg.id = src.transfer_pair_id AND leg.user_id = src.user_id
        WHERE src.account_id = $1 AND src.user_id = $2
          AND src.type = 'transfer' AND src.transfer_to_account_id IS NOT NULL
          AND a.id = src.transfer_to_account_id AND a.user_id = $2
      `, [id, userId])
      await client.query(`
        UPDATE accounts a
        SET balance = a.balance - COALESCE(leg.amount, src.amount)
        FROM transactions src
        LEFT JOIN LATERAL (
          SELECT l.amount FROM transactions l
          WHERE l.type = 'income' AND l.account_id = src.transfer_to_account_id
            AND l.transfer_to_account_id = src.account_id AND l.user_id = src.user_id
            AND l.transfer_pair_id IS NULL
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) leg ON true
        WHERE src.account_id = $1 AND src.user_id = $2
          AND src.type = 'transfer' AND src.transfer_to_account_id IS NOT NULL
          AND src.transfer_pair_id IS NULL
          AND a.id = src.transfer_to_account_id AND a.user_id = $2
      `, [id, userId])

      // Transfers INTO this account deducted other accounts — give the money
      // back before their source rows are removed together with the account.
      await client.query(`
        UPDATE accounts a
        SET balance = a.balance + src.amount
        FROM transactions src
        WHERE src.transfer_to_account_id = $1 AND src.account_id <> $1
          AND src.type = 'transfer' AND src.user_id = $2
          AND a.id = src.account_id AND a.user_id = $2
      `, [id, userId])

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
