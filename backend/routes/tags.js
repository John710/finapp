async function tagRoutes(fastify, opts) {
  // List all tags
  fastify.get('/tags', async (request, reply) => {
    const result = await fastify.db.query(
      `SELECT t.*, COUNT(tt.transaction_id)::int as transaction_count
       FROM tags t
       LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
       GROUP BY t.id
       ORDER BY transaction_count DESC, t.name ASC`
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
    const { name, color } = request.body
    const result = await fastify.db.query(
      'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
      [name, color || null]
    )
    reply.code(201)
    return result.rows[0]
  })

  // Update
  fastify.put('/tags/:id', async (request, reply) => {
    const { id } = request.params
    const { name, color } = request.body
    const result = await fastify.db.query(
      'UPDATE tags SET name = $1, color = $2 WHERE id = $3 RETURNING *',
      [name, color, id]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Tag not found' }
    }
    return result.rows[0]
  })

  // Delete
  fastify.delete('/tags/:id', async (request, reply) => {
    const { id } = request.params
    await fastify.db.query('DELETE FROM tags WHERE id = $1', [id])
    reply.code(204)
  })
}

export default tagRoutes
