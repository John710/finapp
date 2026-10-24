import { t, getUserLang } from '../services/i18n.js'

async function recurringRoutes(fastify, opts) {
  // List
  fastify.get('/recurring', async (request, reply) => {
    const userId = request.user.userId
    const result = await fastify.db.query(`
      SELECT r.*, a.name as account_name, c.name as category_name,
             CASE WHEN r.user_id = $1 THEN NULL ELSE ou.login END AS owner_login
      FROM recurring_rules r
      LEFT JOIN accounts a ON a.id = r.account_id
      LEFT JOIN categories c ON c.id = r.category_id
      JOIN users ou ON ou.id = r.user_id
      LEFT JOIN entity_shares es ON es.entity_type = 'recurring' AND es.entity_id = r.id
        AND es.owner_id = r.user_id AND (es.shared_with = $1 OR es.shared_with IS NULL)
      WHERE r.user_id = $1 OR es.id IS NOT NULL
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
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          type: { type: 'string', enum: ['income', 'expense'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          next_date: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { account_id, category_id, amount, currency, type, frequency, next_date, note } = request.body
    const accRes = await fastify.db.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
    if (accRes.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.account_not_found', {}, lang) }
    }
    if (category_id) {
      const catRes = await fastify.db.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
      if (catRes.rows.length === 0) {
        reply.code(404)
        return { error: t('errors.category_not_found', {}, lang) }
      }
    }
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
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type', 'frequency', 'next_date'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          type: { type: 'string', enum: ['income', 'expense'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          next_date: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 1000 },
          is_active: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { account_id, category_id, amount, currency, type, frequency, next_date, note, is_active } = request.body
    const accRes = await fastify.db.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
    if (accRes.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.account_not_found', {}, lang) }
    }
    if (category_id) {
      const catRes = await fastify.db.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
      if (catRes.rows.length === 0) {
        reply.code(404)
        return { error: t('errors.category_not_found', {}, lang) }
      }
    }
    const result = await fastify.db.query(
      'UPDATE recurring_rules SET account_id = $1, category_id = $2, amount = $3, currency = $4, type = $5, frequency = $6, next_date = $7, note = $8, is_active = $9 WHERE id = $10 AND user_id = $11 RETURNING *',
      [account_id, category_id, amount, currency, type, frequency, next_date, note, is_active, id, userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.rule_not_found', {}, lang) }
    }
    return result.rows[0]
  })

  // Delete
  fastify.delete('/recurring/:id', {
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
    await fastify.db.query("DELETE FROM entity_shares WHERE entity_type = 'recurring' AND entity_id = $1", [id])
    const result = await fastify.db.query('DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2', [id, userId])
    if (result.rowCount === 0) {
      reply.code(404)
      return { error: t('errors.rule_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default recurringRoutes
