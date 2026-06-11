import bcrypt from 'bcryptjs'
import { notify, checkDuplicateNotification } from '../services/notify.js'
import { t, getUserLang } from '../services/i18n.js'

async function authRoutes(fastify, opts) {
  // Check if setup needed
  fastify.get('/auth/setup-required', async (request, reply) => {
    const result = await fastify.db.query('SELECT 1 FROM users LIMIT 1')
    return { required: result.rows.length === 0 }
  })

  // Setup wizard (first user)
  fastify.post('/auth/setup', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 6 },
          language: { type: 'string', default: 'ru' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password, language } = request.body
    const existing = await fastify.db.query('SELECT 1 FROM users LIMIT 1')
    if (existing.rows.length > 0) {
      reply.code(400)
      return { error: 'User already exists' }
    }

    const hash = await bcrypt.hash(password, 12)
    await fastify.db.query(
      'INSERT INTO users (login, password_hash, language) VALUES ($1, $2, $3)',
      [login, hash, language || process.env.DEFAULT_LANG || 'ru']
    )
    return { success: true }
  })

  // Login
  fastify.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string' },
          password: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password } = request.body
    fastify.log.info(`Login attempt for user: ${login}`)
    const result = await fastify.db.query('SELECT * FROM users WHERE login = $1', [login])
    if (result.rows.length === 0) {
      fastify.log.warn(`Login failed: user not found: ${login}`)
      // Notify first user (single-user app)
      try {
        const userRes = await fastify.db.query('SELECT id FROM users LIMIT 1')
        const userId = userRes.rows[0]?.id
        if (userId) {
          const lang = await getUserLang(fastify.db)
          const dup = await checkDuplicateNotification(fastify, { userId, type: 'login_failed', entityId: login, hours: 1 })
          if (!dup) {
            const title = t('notifications.login_failed', {}, lang)
            const message = t('notifications.login_failed_body', { login, ip: request.ip || 'unknown' }, lang)
            await notify(fastify, userId, {
              type: 'login_failed', title, message,
              data: { entity_id: login, url: '/settings' },
              channels: ['push', 'shoutrrr']
            })
          }
        }
      } catch (notifErr) {
        fastify.log.warn(notifErr, 'Login failed notification error')
      }
      reply.code(401)
      return { error: 'Invalid credentials' }
    }

    const user = result.rows[0]
    if (!user.password_hash) {
      fastify.log.error(`Login failed: user ${login} has no password_hash`)
      reply.code(401)
      return { error: 'Invalid credentials' }
    }
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      fastify.log.warn(`Login failed: invalid password for user: ${login}`)
      try {
        const lang = await getUserLang(fastify.db)
        const dup = await checkDuplicateNotification(fastify, { userId: user.id, type: 'login_failed', entityId: login, hours: 1 })
        if (!dup) {
          const title = t('notifications.login_failed', {}, lang)
          const message = t('notifications.login_failed_body', { login, ip: request.ip || 'unknown' }, lang)
          await notify(fastify, user.id, {
            type: 'login_failed', title, message,
            data: { entity_id: login, url: '/settings' },
            channels: ['push', 'shoutrrr']
          })
        }
      } catch (notifErr) {
        fastify.log.warn(notifErr, 'Login failed notification error')
      }
      reply.code(401)
      return { error: 'Invalid credentials' }
    }
    fastify.log.info(`Login successful for user: ${login}`)

    const accessToken = fastify.signAccessToken({ userId: user.id, login: user.login })
    const refreshToken = fastify.signRefreshToken({ userId: user.id })

    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/'
    })

    return {
      accessToken,
      user: { id: user.id, login: user.login, language: user.language, base_currency: user.base_currency, coingecko_api_key: user.coingecko_api_key }
    }
  })

  // Refresh
  fastify.post('/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken
    if (!refreshToken) {
      reply.code(401)
      return { error: 'No refresh token' }
    }

    try {
      const payload = fastify.verifyToken(refreshToken)
      const result = await fastify.db.query('SELECT * FROM users WHERE id = $1', [payload.userId])
      if (result.rows.length === 0) {
        reply.code(401)
        return { error: 'User not found' }
      }

      const user = result.rows[0]
      const accessToken = fastify.signAccessToken({ userId: user.id, login: user.login })
      return { accessToken, user: { id: user.id, login: user.login, language: user.language, base_currency: user.base_currency, coingecko_api_key: user.coingecko_api_key } }
    } catch (err) {
      reply.code(401)
      return { error: 'Invalid refresh token' }
    }
  })

  // Update user settings
  fastify.patch('/users/settings', async (request, reply) => {
    const { language, base_currency, coingecko_api_key } = request.body
    const fields = []
    const values = []
    let idx = 1
    if (language !== undefined) { fields.push(`language = $${idx++}`); values.push(language) }
    if (base_currency !== undefined) { fields.push(`base_currency = $${idx++}`); values.push(base_currency) }
    if (coingecko_api_key !== undefined) { fields.push(`coingecko_api_key = $${idx++}`); values.push(coingecko_api_key) }
    if (fields.length === 0) return { success: false, error: 'No fields to update' }
    values.push(request.user.userId)
    await fastify.db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values)
    return { success: true }
  })

  fastify.get('/users/me', async (request, reply) => {
    const result = await fastify.db.query('SELECT id, login, language, base_currency, coingecko_api_key FROM users WHERE id = $1', [request.user.userId])
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'User not found' }
    }
    return result.rows[0]
  })

  fastify.patch('/users/language', async (request, reply) => {
    const { language } = request.body
    await fastify.db.query('UPDATE users SET language = $1 WHERE id = $2', [language, request.user.userId])
    return { success: true }
  })

  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie('refreshToken', { httpOnly: true, sameSite: 'lax', path: '/' })
    return { success: true }
  })
}

export default authRoutes
