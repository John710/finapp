import crypto from 'node:crypto'
import { t, getUserLang } from '../services/i18n.js'

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = [/^image\/(png|jpe?g|webp|gif)$/, /^application\/pdf$/, /^text\/plain$/]

async function attachmentRoutes(fastify, opts) {
  // Upload one attachment to a transaction (multipart)
  fastify.post('/transactions/:id/attachments', {
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
    const lang = await getUserLang(fastify.db, userId)

    const txRes = await fastify.db.query('SELECT id FROM transactions WHERE id = $1 AND user_id = $2', [id, userId])
    if (txRes.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.transaction_not_found', {}, lang) }
    }

    const data = await request.file()
    if (!data) {
      reply.code(400)
      return { error: t('errors.no_file_uploaded', {}, lang) }
    }

    const mime = data.mimetype || 'application/octet-stream'
    if (!ALLOWED_MIME.some(re => re.test(mime))) {
      reply.code(400)
      return { error: t('errors.attachment_invalid_type', {}, lang) }
    }

    const buffer = await data.toBuffer()
    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      reply.code(400)
      return { error: t('errors.attachment_too_large', {}, lang) }
    }

    const result = await fastify.db.query(
      'INSERT INTO attachments (user_id, transaction_id, filename, mime, size, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename, mime, size, created_at',
      [userId, id, data.filename || 'file', mime, buffer.length, buffer]
    )
    reply.code(201)
    return result.rows[0]
  })

  // List attachments of a transaction (metadata only)
  fastify.get('/transactions/:id/attachments', {
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
    const result = await fastify.db.query(
      'SELECT id, filename, mime, size, created_at FROM attachments WHERE transaction_id = $1 AND user_id = $2 ORDER BY created_at',
      [id, userId]
    )
    return result.rows
  })

  // Download an attachment
  fastify.get('/attachments/:id', {
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
    const result = await fastify.db.query(
      'SELECT filename, mime, data FROM attachments WHERE id = $1 AND user_id = $2',
      [id, userId]
    )
    const att = result.rows[0]
    if (!att) {
      const lang = await getUserLang(fastify.db, userId)
      reply.code(404)
      return { error: t('errors.attachment_not_found', {}, lang) }
    }
    const etag = `"${crypto.createHash('md5').update(att.data).digest('hex')}"`
    reply.header('ETag', etag)
    reply.header('Cache-Control', 'private, no-cache')
    reply.header('Content-Type', att.mime)
    const asciiName = att.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
    reply.header('Content-Disposition', `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`)
    return att.data
  })

  fastify.delete('/attachments/:id', {
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
    const result = await fastify.db.query('DELETE FROM attachments WHERE id = $1 AND user_id = $2', [id, userId])
    if (result.rowCount === 0) {
      const lang = await getUserLang(fastify.db, userId)
      reply.code(404)
      return { error: t('errors.attachment_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default attachmentRoutes
