import { sanitizeSvg } from '../services/sanitizeSvg.js'

async function categoryRoutes(fastify, opts) {
  // List
  fastify.get('/categories', async (request, reply) => {
    const userId = request.user.userId
    const result = await fastify.db.query(
      'SELECT * FROM categories WHERE user_id = $1 ORDER BY type, name',
      [userId]
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
    const { name, type, color, icon, icon_custom, parent_id } = request.body
    if (parent_id) {
      const parentRes = await fastify.db.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [parent_id, userId])
      if (parentRes.rows.length === 0) {
        reply.code(404)
        return { error: 'Parent category not found' }
      }
    }
    const safeIconCustom = sanitizeSvg(icon_custom)
    const result = await fastify.db.query(
      'INSERT INTO categories (user_id, name, type, color, icon, icon_custom, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [userId, name, type, color, icon, safeIconCustom, parent_id]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/categories/:id', {
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
    const { id } = request.params
    const { name, type, color, icon, icon_custom, parent_id } = request.body
    if (parent_id) {
      if (parent_id === id) {
        reply.code(400)
        return { error: 'Category cannot be its own parent' }
      }
      const parentRes = await fastify.db.query('SELECT id, parent_id FROM categories WHERE id = $1 AND user_id = $2', [parent_id, userId])
      if (parentRes.rows.length === 0) {
        reply.code(404)
        return { error: 'Parent category not found' }
      }
      if (parentRes.rows[0].parent_id === id) {
        reply.code(400)
        return { error: 'Category hierarchy cannot contain cycles' }
      }
    }
    const safeIconCustom = sanitizeSvg(icon_custom)
    const result = await fastify.db.query(
      'UPDATE categories SET name = $1, type = $2, color = $3, icon = $4, icon_custom = $5, parent_id = $6 WHERE id = $7 AND user_id = $8 RETURNING *',
      [name, type, color, icon, safeIconCustom, parent_id, id, userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Category not found' }
    }
    return result.rows[0]
  })

  // Delete
  fastify.delete('/categories/:id', {
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
    await fastify.db.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, userId])
    reply.code(204)
  })
}

export default categoryRoutes
