import bcrypt from 'bcryptjs'
import { t, getUserLang } from '../services/i18n.js'
import { passwordTooLong, revokeUserCredentials } from '../services/credentials.js'

// User management — admin only. Registration stays closed; the admin creates
// accounts. Every user is a peer with their own data.
async function usersAdminRoutes(fastify, opts) {
  fastify.get('/admin/users', async (request, reply) => {
    if (request.user.role !== 'admin') {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(403)
      return { error: t('errors.admin_only', {}, lang) }
    }
    const { rows } = await fastify.db.query(
      'SELECT id, login, role, created_at, totp_enabled FROM users ORDER BY created_at'
    )
    return rows
  })

  fastify.post('/admin/users', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string', minLength: 3, maxLength: 64 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          role: { type: 'string', enum: ['user', 'admin'], default: 'user' }
        }
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(403)
      return { error: t('errors.admin_only', {}, lang) }
    }
    const { login, password, role } = request.body
    if (passwordTooLong(password)) {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(400)
      return { error: t('auth.password_too_long', {}, lang) }
    }
    const hash = await bcrypt.hash(password, 12)
    try {
      const result = await fastify.db.query(
        'INSERT INTO users (login, password_hash, role) VALUES ($1, $2, $3) RETURNING id, login, role, created_at',
        [login, hash, role || 'user']
      )
      reply.code(201)
      return result.rows[0]
    } catch (err) {
      if (err.code === '23505') {
        const lang = await getUserLang(fastify.db, request.user.userId)
        reply.code(409)
        return { error: t('errors.login_taken', {}, lang) }
      }
      throw err
    }
  })

  fastify.patch('/admin/users/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        properties: {
          password: { type: 'string', minLength: 8, maxLength: 128 },
          role: { type: 'string', enum: ['user', 'admin'] },
          // Recovery for a user who lost their authenticator: turns 2FA off
          // and clears the secret, the lockout and the replay marker.
          reset_2fa: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(403)
      return { error: t('errors.admin_only', {}, lang) }
    }
    const userId = request.user.userId
    const { id } = request.params
    const { password, role, reset_2fa: reset2fa } = request.body
    const lang = await getUserLang(fastify.db, userId)
    if (password && passwordTooLong(password)) {
      reply.code(400)
      return { error: t('auth.password_too_long', {}, lang) }
    }

    // Never demote or lock out the last admin
    if (role === 'user' || (id === userId && password)) {
      if (role === 'user' && id === userId) {
        reply.code(400)
        return { error: t('errors.admin_last', {}, lang) }
      }
    }
    if (role === 'user') {
      const admins = await fastify.db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'")
      const target = await fastify.db.query('SELECT role FROM users WHERE id = $1', [id])
      if (target.rows[0]?.role === 'admin' && admins.rows[0].n <= 1) {
        reply.code(400)
        return { error: t('errors.admin_last', {}, lang) }
      }
    }

    const fields = []
    const values = []
    let idx = 1
    if (password) { fields.push(`password_hash = $${idx++}`); values.push(await bcrypt.hash(password, 12)) }
    if (role) { fields.push(`role = $${idx++}`); values.push(role) }
    if (reset2fa) {
      fields.push('totp_enabled = false', 'totp_secret = NULL', 'totp_failed_attempts = 0',
        'totp_locked_until = NULL', 'totp_last_step = NULL')
    }
    if (fields.length === 0) {
      reply.code(400)
      return { error: t('errors.no_fields_to_update', {}, lang) }
    }
    values.push(id)

    // The update and the revocation land together: a password reset that left
    // the old sessions or API tokens alive would not lock out whoever had them.
    const client = await fastify.db.connect()
    let result
    try {
      await client.query('BEGIN')
      result = await client.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, login, role, totp_enabled`,
        values
      )
      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.user_not_found', {}, lang) }
      }
      if (password) {
        // Sessions, personal API tokens and calendar feed tokens all go
        await revokeUserCredentials(client, id)
      } else if (role === 'user') {
        // A demotion already takes effect on the next request (the role is read
        // from the database); the sessions are still ended as before.
        await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    if (reset2fa) {
      fastify.log.info({ adminId: userId, userId: id }, 'Two-factor authentication reset by admin')
    }
    return result.rows[0]
  })

  fastify.delete('/admin/users/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(403)
      return { error: t('errors.admin_only', {}, lang) }
    }
    const userId = request.user.userId
    const { id } = request.params
    if (id === userId) {
      const lang = await getUserLang(fastify.db, userId)
      reply.code(400)
      return { error: t('errors.admin_self_delete', {}, lang) }
    }
    const target = await fastify.db.query('SELECT role FROM users WHERE id = $1', [id])
    if (target.rows.length === 0) {
      const lang = await getUserLang(fastify.db, userId)
      reply.code(404)
      return { error: t('errors.user_not_found', {}, lang) }
    }
    if (target.rows[0].role === 'admin') {
      const admins = await fastify.db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'")
      if (admins.rows[0].n <= 1) {
        const lang = await getUserLang(fastify.db, userId)
        reply.code(400)
        return { error: t('errors.admin_last', {}, lang) }
      }
    }
    // Entity shares owned or received by the user die with them (FK cascade);
    // their own entities (accounts, transactions, ...) cascade via user_id.
    await fastify.db.query('DELETE FROM users WHERE id = $1', [id])
    reply.code(204)
  })
}

export default usersAdminRoutes
