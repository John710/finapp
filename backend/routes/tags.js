import { t, getUserLang } from '../services/i18n.js'
import { visibleAccountIds } from '../services/visibility.js'
import { catalogAdminOnly } from '../services/catalog-access.js'

async function tagRoutes(fastify, opts) {
  // List all tags (global — shared by every user of the instance). The usage
  // count only covers transactions the caller can see: tags are shared, other
  // users' ledgers are not.
  fastify.get('/tags', async (request, reply) => {
    const visible = await visibleAccountIds(fastify.db, request.user.userId)
    const result = await fastify.db.query(
      `SELECT t.*, COUNT(tx.id)::int as transaction_count
       FROM tags t
       LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
       LEFT JOIN transactions tx ON tx.id = tt.transaction_id AND tx.account_id = ANY($1)
       GROUP BY t.id
       ORDER BY transaction_count DESC, t.name ASC`,
      [visible]
    )
    return result.rows
  })

  // Create
  fastify.post('/tags', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          color: { type: 'string', maxLength: 32 }
        }
      }
    }
  }, async (request, reply) => {
    const { name, color } = request.body
    const result = await fastify.db.query(
      'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
      [name, color || null]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update (admin only — the tag is shared by every user)
  fastify.put('/tags/:id', {
    preHandler: catalogAdminOnly,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          color: { type: 'string', maxLength: 32 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { name, color } = request.body
    const result = await fastify.db.query(
      'UPDATE tags SET name = $1, color = $2 WHERE id = $3 RETURNING *',
      [name, color, id]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.tag_not_found', {}, lang) }
    }
    return result.rows[0]
  })

  // Delete (admin only — removes the tag from every user's transactions)
  fastify.delete('/tags/:id', {
    preHandler: catalogAdminOnly,
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
    const result = await fastify.db.query('DELETE FROM tags WHERE id = $1', [id])
    if (result.rowCount === 0) {
      reply.code(404)
      return { error: t('errors.tag_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default tagRoutes
