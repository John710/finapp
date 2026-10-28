import { t, getUserLang } from '../services/i18n.js'

async function accountRoutes(fastify, opts) {
  // List: own accounts plus accounts shared with the user (or with the family).
  // An account can carry both a family-wide and a personal grant; the LATERAL
  // picks one (the most permissive, like services/visibility.js) so the
  // account is listed once.
  fastify.get('/accounts', async (request, reply) => {
    const userId = request.user.userId
    const result = await fastify.db.query(
      `SELECT a.*,
              CASE WHEN a.user_id = $1 THEN NULL ELSE ou.login END AS owner_login,
              CASE WHEN a.user_id = $1 THEN EXISTS (SELECT 1 FROM entity_shares es WHERE es.entity_type = 'account' AND es.entity_id = a.id AND es.owner_id = a.user_id) ELSE false END AS is_shared,
              CASE WHEN a.user_id = $1 THEN 'owner' ELSE share.permission END AS access
       FROM accounts a
       JOIN users ou ON ou.id = a.user_id
       LEFT JOIN LATERAL (
         SELECT es.permission FROM entity_shares es
         WHERE es.entity_type = 'account' AND es.entity_id = a.id
           AND es.owner_id = a.user_id AND (es.shared_with = $1 OR es.shared_with IS NULL)
         ORDER BY (es.permission = 'edit') DESC
         LIMIT 1
       ) share ON a.user_id <> $1
       WHERE a.user_id = $1 OR share.permission IS NOT NULL
       ORDER BY a.is_archived, a.sort_order, a.created_at DESC`,
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
      // UPDATE ... FROM applies only ONE joined row per target row, so N
      // transfers to the same counterparty must be summed per account first;
      // joining the raw transfer rows would reverse just one of them.
      await client.query(`
        UPDATE accounts a
        SET balance = a.balance - agg.total
        FROM (
          SELECT src.transfer_to_account_id AS account_id, SUM(leg.amount) AS total
          FROM transactions src
          JOIN transactions leg ON leg.id = src.transfer_pair_id AND leg.user_id = src.user_id
          WHERE src.account_id = $1 AND src.user_id = $2
            AND src.type = 'transfer' AND src.transfer_to_account_id IS NOT NULL
          GROUP BY src.transfer_to_account_id
        ) agg
        WHERE a.id = agg.account_id AND a.user_id = $2
      `, [id, userId])
      await client.query(`
        UPDATE accounts a
        SET balance = a.balance - agg.total
        FROM (
          SELECT src.transfer_to_account_id AS account_id, SUM(COALESCE(leg.amount, src.amount)) AS total
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
          GROUP BY src.transfer_to_account_id
        ) agg
        WHERE a.id = agg.account_id AND a.user_id = $2
      `, [id, userId])

      // Transfers INTO this account deducted other accounts — give the money
      // back before their source rows are removed together with the account.
      await client.query(`
        UPDATE accounts a
        SET balance = a.balance + agg.total
        FROM (
          SELECT src.account_id, SUM(src.amount) AS total
          FROM transactions src
          WHERE src.transfer_to_account_id = $1 AND src.account_id <> $1
            AND src.type = 'transfer' AND src.user_id = $2
          GROUP BY src.account_id
        ) agg
        WHERE a.id = agg.account_id AND a.user_id = $2
      `, [id, userId])

      // transaction_tags rows cascade via FK; remove every transaction that
      // lives on this account or references it as a transfer counterparty.
      // Share grants for this account are removed manually (entity_id is a
      // generic reference without FK).
      await client.query(
        'DELETE FROM transactions WHERE (account_id = $1 OR transfer_to_account_id = $1) AND user_id = $2',
        [id, userId]
      )
      await client.query("DELETE FROM entity_shares WHERE entity_type = 'account' AND entity_id = $1", [id])
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
