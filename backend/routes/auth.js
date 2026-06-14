import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { notify, checkDuplicateNotification } from '../services/notify.js'
import { t, getUserLang } from '../services/i18n.js'

const ACCESS_TOKEN_NAME = 'accessToken'
const REFRESH_TOKEN_NAME = 'refreshToken'

function getCookieOptions(req, maxAge) {
  // Trust proxy headers (X-Forwarded-Proto) so that behind Traefik/Nginx req.protocol is 'https'
  const isSecure = req.protocol === 'https'
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure,
    maxAge,
    path: '/'
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function authRoutes(fastify, opts) {
  fastify.get('/auth/setup-required', async (request, reply) => {
    const result = await fastify.db.query('SELECT 1 FROM users LIMIT 1')
    return { required: result.rows.length === 0 }
  })

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
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      // Prevent concurrent setup requests from creating multiple users
      await client.query('SELECT pg_advisory_xact_lock(123456)')
      const existing = await client.query('SELECT 1 FROM users LIMIT 1')
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: 'User already exists' }
      }

      const hash = await bcrypt.hash(password, 12)
      await client.query(
        'INSERT INTO users (login, password_hash, language) VALUES ($1, $2, $3)',
        [login, hash, language || process.env.DEFAULT_LANG || 'ru']
      )
      await client.query('COMMIT')
      return { success: true }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

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
      try {
        const userRes = await fastify.db.query('SELECT id FROM users ORDER BY id LIMIT 1')
        const userId = userRes.rows[0]?.id
        if (userId) {
          const lang = await getUserLang(fastify.db, userId)
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
        const lang = await getUserLang(fastify.db, user.id)
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
    const refreshTokenHash = hashToken(refreshToken)
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await fastify.db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshTokenHash, refreshExpires]
    )

    reply.setCookie(ACCESS_TOKEN_NAME, accessToken, getCookieOptions(request, 15 * 60 * 1000))
    reply.setCookie(REFRESH_TOKEN_NAME, refreshToken, getCookieOptions(request, 30 * 24 * 60 * 60 * 1000))

    return {
      user: {
        id: user.id,
        login: user.login,
        language: user.language,
        base_currency: user.base_currency,
        coingecko_api_key: user.coingecko_api_key,
        shoutrrr_url: user.shoutrrr_url,
        vapid_public_key: user.vapid_public_key,
        vapid_subject: user.vapid_subject
      }
    }
  })

  fastify.post('/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken
    if (!refreshToken) {
      reply.code(401)
      return { error: 'No refresh token' }
    }

    try {
      const payload = fastify.verifyToken(refreshToken)
      const tokenHash = hashToken(refreshToken)
      const tokenRes = await fastify.db.query(
        'SELECT * FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()',
        [payload.userId, tokenHash]
      )
      if (tokenRes.rows.length === 0) {
        reply.code(401)
        return { error: 'Invalid refresh token' }
      }

      const result = await fastify.db.query('SELECT * FROM users WHERE id = $1', [payload.userId])
      if (result.rows.length === 0) {
        reply.code(401)
        return { error: 'User not found' }
      }

      const user = result.rows[0]

      // Rotate refresh token
      await fastify.db.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenRes.rows[0].id])
      const newAccessToken = fastify.signAccessToken({ userId: user.id, login: user.login })
      const newRefreshToken = fastify.signRefreshToken({ userId: user.id })
      const newRefreshTokenHash = hashToken(newRefreshToken)
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await fastify.db.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, newRefreshTokenHash, refreshExpires]
      )

      reply.setCookie(ACCESS_TOKEN_NAME, newAccessToken, getCookieOptions(request, 15 * 60 * 1000))
      reply.setCookie(REFRESH_TOKEN_NAME, newRefreshToken, getCookieOptions(request, 30 * 24 * 60 * 60 * 1000))

      return {
        user: {
          id: user.id,
          login: user.login,
          language: user.language,
          base_currency: user.base_currency,
          coingecko_api_key: user.coingecko_api_key,
          shoutrrr_url: user.shoutrrr_url,
          vapid_public_key: user.vapid_public_key,
          vapid_subject: user.vapid_subject
        }
      }
    } catch (err) {
      reply.code(401)
      return { error: 'Invalid refresh token' }
    }
  })

  fastify.patch('/users/settings', async (request, reply) => {
    const { language, base_currency, coingecko_api_key, shoutrrr_url } = request.body
    const fields = []
    const values = []
    let idx = 1
    if (language !== undefined) { fields.push(`language = $${idx++}`); values.push(language) }
    if (base_currency !== undefined) { fields.push(`base_currency = $${idx++}`); values.push(base_currency) }
    if (coingecko_api_key !== undefined) { fields.push(`coingecko_api_key = $${idx++}`); values.push(coingecko_api_key) }
    if (shoutrrr_url !== undefined) { fields.push(`shoutrrr_url = $${idx++}`); values.push((shoutrrr_url || '').trim() || null) }
    if (fields.length === 0) return { success: false, error: 'No fields to update' }
    values.push(request.user.userId)
    await fastify.db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values)
    return { success: true }
  })

  fastify.get('/users/me', async (request, reply) => {
    const result = await fastify.db.query(
      `SELECT id, login, language, base_currency, coingecko_api_key,
              shoutrrr_url, vapid_public_key, vapid_subject
       FROM users WHERE id = $1`,
      [request.user.userId]
    )
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
    const refreshToken = request.cookies?.refreshToken
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken)
      await fastify.db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash])
    }
    reply.clearCookie(ACCESS_TOKEN_NAME, { httpOnly: true, sameSite: 'strict', path: '/' })
    reply.clearCookie(REFRESH_TOKEN_NAME, { httpOnly: true, sameSite: 'strict', path: '/' })
    return { success: true }
  })
}

export default authRoutes
