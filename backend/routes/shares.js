import { t, getUserLang } from '../services/i18n.js'

// Generic share management for shareable entities. Replace-all semantics:
// a PUT stores exactly the submitted configuration.
const ENTITIES = {
  account: 'accounts',
  budget: 'budgets',
  debt: 'debts',
  recurring: 'recurring_rules'
}

function resolveEntity(type) {
  return ENTITIES[type] || null
}

async function sharesRoutes(fastify, opts) {
  // Directory of users for the share picker (id + login only)
  fastify.get('/users/directory', async (request) => {
    const { rows } = await fastify.db.query(
      'SELECT id, login FROM users WHERE id <> $1 ORDER BY login',
      [request.user.userId]
    )
    return rows
  })

  fastify.get('/shares/:entityType/:entityId', {
    schema: {
      params: {
        type: 'object',
        required: ['entityType', 'entityId'],
        properties: {
          entityType: { type: 'string', enum: Object.keys(ENTITIES) },
          entityId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { entityType, entityId } = request.params
    const table = resolveEntity(entityType)

    const own = await fastify.db.query(`SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`, [entityId, userId])
    if (own.rows.length === 0) {
      const lang = await getUserLang(fastify.db, userId)
      reply.code(404)
      return { error: t('errors.not_found', {}, lang) }
    }

    const { rows } = await fastify.db.query(
      `SELECT es.shared_with, es.permission, u.login
       FROM entity_shares es LEFT JOIN users u ON u.id = es.shared_with
       WHERE es.entity_type = $1 AND es.entity_id = $2 AND es.owner_id = $3`,
      [entityType, entityId, userId]
    )
    return {
      family: rows.filter(r => r.shared_with === null).map(r => r.permission)[0] || null,
      users: rows.filter(r => r.shared_with !== null).map(r => ({ id: r.shared_with, login: r.login, permission: r.permission }))
    }
  })

  fastify.put('/shares/:entityType/:entityId', {
    schema: {
      params: {
        type: 'object',
        required: ['entityType', 'entityId'],
        properties: {
          entityType: { type: 'string', enum: Object.keys(ENTITIES) },
          entityId: { type: 'integer', minimum: 1 }
        }
      },
      body: {
        type: 'object',
        properties: {
          family: { type: ['string', 'null'], enum: ['view', 'edit', null] },
          users: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              required: ['id', 'permission'],
              properties: {
                id: { type: 'integer', minimum: 1 },
                permission: { type: 'string', enum: ['view', 'edit'] }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { entityType, entityId } = request.params
    const table = resolveEntity(entityType)
    const lang = await getUserLang(fastify.db, userId)

    const own = await fastify.db.query(`SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`, [entityId, userId])
    if (own.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.not_found', {}, lang) }
    }

    const { family = null, users = [] } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM entity_shares WHERE entity_type = $1 AND entity_id = $2 AND owner_id = $3', [entityType, entityId, userId])
      if (family) {
        await client.query(
          'INSERT INTO entity_shares (entity_type, entity_id, owner_id, shared_with, permission) VALUES ($1, $2, $3, NULL, $4)',
          [entityType, entityId, userId, family]
        )
      }
      for (const u of users) {
        if (u.id === userId) continue
        await client.query(
          `INSERT INTO entity_shares (entity_type, entity_id, owner_id, shared_with, permission)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [entityType, entityId, userId, u.id, u.permission]
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
}

export default sharesRoutes
