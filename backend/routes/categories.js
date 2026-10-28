import { sanitizeSvg } from '../services/sanitizeSvg.js'
import { t, getUserLang } from '../services/i18n.js'
import { catalogAdminOnly } from '../services/catalog-access.js'

async function categoryRoutes(fastify, opts) {
  // List (categories are global — shared by every user of the instance)
  fastify.get('/categories', async (request, reply) => {
    const result = await fastify.db.query(
      'SELECT * FROM categories ORDER BY type, name'
    )
    return result.rows
  })

  // Create
  fastify.post('/categories', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['income', 'expense'] },
          color: { type: 'string', maxLength: 32 },
          icon: { type: 'string', maxLength: 100 },
          icon_custom: { type: 'string' },
          parent_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { name, type, color, icon, icon_custom, parent_id } = request.body
    if (parent_id) {
      const parentRes = await fastify.db.query('SELECT id FROM categories WHERE id = $1', [parent_id])
      if (parentRes.rows.length === 0) {
        reply.code(404)
        return { error: t('errors.parent_category_not_found', {}, lang) }
      }
    }
    const safeIconCustom = sanitizeSvg(icon_custom)
    const result = await fastify.db.query(
      'INSERT INTO categories (name, type, color, icon, icon_custom, parent_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, type, color, icon, safeIconCustom, parent_id]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update (admin only — the category is shared by every user)
  fastify.put('/categories/:id', {
    preHandler: catalogAdminOnly,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['income', 'expense'] },
          color: { type: 'string', maxLength: 32 },
          icon: { type: 'string', maxLength: 100 },
          icon_custom: { type: 'string' },
          parent_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { name, type, color, icon, icon_custom, parent_id } = request.body
    if (parent_id) {
      if (parent_id === id) {
        reply.code(400)
        return { error: t('errors.category_self_parent', {}, lang) }
      }
      const parentRes = await fastify.db.query('SELECT id, parent_id FROM categories WHERE id = $1', [parent_id])
      if (parentRes.rows.length === 0) {
        reply.code(404)
        return { error: t('errors.parent_category_not_found', {}, lang) }
      }
      if (parentRes.rows[0].parent_id === id) {
        reply.code(400)
        return { error: t('errors.category_cycle', {}, lang) }
      }
    }
    const safeIconCustom = sanitizeSvg(icon_custom)
    const result = await fastify.db.query(
      'UPDATE categories SET name = $1, type = $2, color = $3, icon = $4, icon_custom = $5, parent_id = $6 WHERE id = $7 RETURNING *',
      [name, type, color, icon, safeIconCustom, parent_id, id]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.category_not_found', {}, lang) }
    }
    return result.rows[0]
  })

  // Delete (admin only — budgets.category_id cascades for every user)
  fastify.delete('/categories/:id', {
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
    const result = await fastify.db.query('DELETE FROM categories WHERE id = $1', [id])
    if (result.rowCount === 0) {
      reply.code(404)
      return { error: t('errors.category_not_found', {}, lang) }
    }
    reply.code(204)
  })

  // Merge: move all transactions, recurring rules and budgets from :id into
  // the target category, then delete :id. Categories are global, so this
  // rewrites every user's rows — admin only.
  fastify.post('/categories/:id/merge', {
    preHandler: catalogAdminOnly,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['target_id'],
        properties: { target_id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { target_id } = request.body

    if (id === target_id) {
      reply.code(400)
      return { error: t('errors.merge_same_target', {}, lang) }
    }

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const catRes = await client.query(
        'SELECT id, type, name FROM categories WHERE id IN ($1, $2) FOR UPDATE',
        [id, target_id]
      )
      const source = catRes.rows.find(c => c.id === id)
      const target = catRes.rows.find(c => c.id === target_id)
      if (!source || !target) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.category_not_found', {}, lang) }
      }
      if (source.type !== target.type) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.merge_type_mismatch', {}, lang) }
      }

      // Drop each user's source budgets that would duplicate that user's
      // existing target budget of the same period, then move the rest.
      await client.query(
        `DELETE FROM budgets b USING budgets tb
         WHERE b.category_id = $1
           AND tb.category_id = $2 AND tb.user_id = b.user_id AND tb.period = b.period`,
        [id, target_id]
      )
      await client.query('UPDATE transactions SET category_id = $1 WHERE category_id = $2', [target_id, id])
      await client.query('UPDATE recurring_rules SET category_id = $1 WHERE category_id = $2', [target_id, id])
      await client.query('UPDATE budgets SET category_id = $1 WHERE category_id = $2', [target_id, id])
      await client.query('DELETE FROM categories WHERE id = $1', [id])

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

export default categoryRoutes
