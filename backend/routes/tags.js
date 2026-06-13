async function tagRoutes(fastify, opts) {
  // List all tags
  fastify.get('/tags', async (request, reply) => {
    const userId = request.user.userId
    const result = await fastify.db.query(
      `SELECT t.*, COUNT(tt.transaction_id)::int as transaction_count
       FROM tags t
       LEFT JOIN transaction_tags tt ON tt.tag_id = t.id AND tt.user_id = $1
       WHERE t.user_id = $1
       GROUP BY t.id
       ORDER BY transaction_count DESC, t.name ASC`,
      [userId]
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
          name: { type: 'string', minLength: 1 },
          color: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { name, color } = request.body
    const result = await fastify.db.query(
      'INSERT INTO tags (user_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [userId, name, color || null]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/tags/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          color: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const { name, color } = request.body
    const result = await fastify.db.query(
      'UPDATE tags SET name = $1, color = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
      [name, color, id, userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Tag not found' }
    }
    return result.rows[0]
  })

  // Delete
  fastify.delete('/tags/:id', async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    await fastify.db.query('DELETE FROM tags WHERE id = $1 AND user_id = $2', [id, userId])
    reply.code(204)
  })
}

export default tagRoutes
