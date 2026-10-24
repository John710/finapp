import crypto from 'node:crypto'
import { t, getUserLang } from '../services/i18n.js'

async function tokenRoutes(fastify, opts) {
  // List personal API tokens (metadata only — the plaintext is shown once at creation)
  fastify.get('/users/tokens', async (request, reply) => {
    const result = await fastify.db.query(
      'SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC',
      [request.user.userId]
    )
    return result.rows
  })

  // Create a token; the plaintext is returned exactly once
  fastify.post('/users/tokens', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const result = await fastify.db.query(
      'INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3) RETURNING id, name, created_at',
      [request.user.userId, request.body.name, tokenHash]
    )
    reply.code(201)
    return { ...result.rows[0], token }
  })

  fastify.delete('/users/tokens/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const result = await fastify.db.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [id, request.user.userId])
    if (result.rowCount === 0) {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(404)
      return { error: t('errors.token_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default tokenRoutes
