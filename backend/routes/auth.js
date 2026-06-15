import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { notify, checkDuplicateNotification } from '../services/notify.js'
import { t, getUserLang, getReqLang } from '../services/i18n.js'
import { encrypt, decrypt } from '../services/crypto.js'

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
  fastify.get('/auth/setup-required', { config: { public: true } }, async (request, reply) => {
    const result = await fastify.db.query('SELECT 1 FROM users LIMIT 1')
    return { required: result.rows.length === 0 }
  })

  fastify.post('/auth/register', {
    config: { public: true },
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 6 },
          language: { type: 'string', default: 'en' }
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
        return { error: t('auth.user_already_exists', {}, language || process.env.DEFAULT_LANG || 'en') }
      }

      const hash = await bcrypt.hash(password, 12)
      await client.query(
        'INSERT INTO users (login, password_hash, language) VALUES ($1, $2, $3)',
        [login, hash, language || process.env.DEFAULT_LANG || 'en']
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
    config: { public: true },
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string' },
          password: { type: 'string' },
          language: { type: 'string', default: 'en' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password } = request.body
    const lang = getReqLang(request)
    fastify.log.info(`Login attempt for user: ${login}`)
    const result = await fastify.db.query('SELECT * FROM users WHERE login = $1', [login])
    if (result.rows.length === 0) {
      fastify.log.warn(`Login failed: user not found: ${login}`)
      reply.code(401)
      return { error: t('auth.invalid_credentials', {}, lang) }
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
      const lang = await getUserLang(fastify.db, user.id)
      reply.code(401)
      return { error: t('auth.invalid_credentials', {}, lang) }
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
        coingecko_api_key: decrypt(user.coingecko_api_key),
        shoutrrr_url: decrypt(user.shoutrrr_url),
        vapid_public_key: user.vapid_public_key,
        vapid_subject: user.vapid_subject
      }
    }
  })

  fastify.post('/auth/refresh', { config: { public: true } }, async (request, reply) => {
    const lang = getReqLang(request)
    const refreshToken = request.cookies?.refreshToken
    if (!refreshToken) {
      reply.code(401)
      return { error: t('auth.no_refresh_token', {}, lang) }
    }

    try {
      const payload = fastify.verifyRefreshToken(refreshToken)
      const tokenHash = hashToken(refreshToken)
      const tokenRes = await fastify.db.query(
        'SELECT * FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()',
        [payload.userId, tokenHash]
      )
      if (tokenRes.rows.length === 0) {
        await fastify.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [payload.userId])
        reply.code(401)
        return { error: t('auth.invalid_refresh_token', {}, lang) }
      }

      const result = await fastify.db.query('SELECT * FROM users WHERE id = $1', [payload.userId])
      if (result.rows.length === 0) {
        reply.code(401)
        return { error: t('auth.user_not_found', {}, lang) }
      }

      const user = result.rows[0]

      // Rotate refresh token atomically
      const newAccessToken = fastify.signAccessToken({ userId: user.id, login: user.login })
      const newRefreshToken = fastify.signRefreshToken({ userId: user.id })
      const newRefreshTokenHash = hashToken(newRefreshToken)
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      const client = await fastify.db.connect()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenRes.rows[0].id])
        await client.query(
          'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
          [user.id, newRefreshTokenHash, refreshExpires]
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }

      reply.setCookie(ACCESS_TOKEN_NAME, newAccessToken, getCookieOptions(request, 15 * 60 * 1000))
      reply.setCookie(REFRESH_TOKEN_NAME, newRefreshToken, getCookieOptions(request, 30 * 24 * 60 * 60 * 1000))

      return {
        user: {
          id: user.id,
          login: user.login,
          language: user.language,
          base_currency: user.base_currency,
          coingecko_api_key: decrypt(user.coingecko_api_key),
          shoutrrr_url: decrypt(user.shoutrrr_url),
          vapid_public_key: user.vapid_public_key,
          vapid_subject: user.vapid_subject
        }
      }
    } catch (err) {
      fastify.log.warn(err, 'Refresh token failed')
      reply.code(401)
      return { error: t('auth.invalid_refresh_token', {}, lang) }
    }
  })

  fastify.patch('/users/settings', {
    schema: {
      body: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['ru', 'en'] },
          base_currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          coingecko_api_key: { type: ['string', 'null'], maxLength: 255 },
          shoutrrr_url: { type: ['string', 'null'], maxLength: 2048 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { language, base_currency, coingecko_api_key, shoutrrr_url } = request.body
      const fields = []
      const values = []
      let idx = 1
      if (language !== undefined) { fields.push(`language = $${idx++}`); values.push(language) }
      if (base_currency !== undefined) { fields.push(`base_currency = $${idx++}`); values.push(base_currency) }
      if (coingecko_api_key !== undefined) { fields.push(`coingecko_api_key = $${idx++}`); values.push(encrypt((coingecko_api_key || '').trim() || null)) }
      if (shoutrrr_url !== undefined) { fields.push(`shoutrrr_url = $${idx++}`); values.push(encrypt((shoutrrr_url || '').trim() || null)) }
      if (fields.length === 0) return { success: false, error: 'No fields to update' }
      values.push(request.user.userId)
      await fastify.db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values)
      return { success: true }
    } catch (err) {
      fastify.log.warn(err, 'Failed to update user settings')
      if (err.message?.includes('ENCRYPTION_KEY')) {
        reply.code(400)
        return { error: 'Encryption key is not configured on the server' }
      }
      reply.code(500)
      return { error: 'Failed to save settings' }
    }
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
    const user = result.rows[0]
    user.shoutrrr_url = decrypt(user.shoutrrr_url)
    user.coingecko_api_key = decrypt(user.coingecko_api_key)
    return user
  })

  fastify.patch('/users/language', {
    schema: {
      body: {
        type: 'object',
        required: ['language'],
        properties: {
          language: { type: 'string', enum: ['ru', 'en'] }
        }
      }
    }
  }, async (request, reply) => {
    const { language } = request.body
    await fastify.db.query('UPDATE users SET language = $1 WHERE id = $2', [language, request.user.userId])
    return { success: true }
  })

  fastify.post('/users/change-password', {
    schema: {
      body: {
        type: 'object',
        required: ['current_password', 'new_password'],
        properties: {
          current_password: { type: 'string' },
          new_password: { type: 'string', minLength: 6 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { current_password, new_password } = request.body
    const lang = await getUserLang(fastify.db, userId)
    const { rows } = await fastify.db.query('SELECT password_hash FROM users WHERE id = $1', [userId])
    if (rows.length === 0) {
      reply.code(404)
      return { error: t('auth.user_not_found', {}, lang) }
    }
    const valid = await bcrypt.compare(current_password, rows[0].password_hash)
    if (!valid) {
      reply.code(401)
      return { error: t('auth.invalid_current_password', {}, lang) }
    }
    const newHash = await bcrypt.hash(new_password, 12)
    await fastify.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId])

    // Require a browser session to keep current session
    const currentRefresh = request.cookies?.refreshToken
    if (!currentRefresh) {
      reply.code(400)
      return { error: t('auth.session_required_for_password_change', {}, lang) }
    }
    const currentHash = hashToken(currentRefresh)
    await fastify.db.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash != $2',
      [userId, currentHash]
    )

    return { success: true }
  })

  fastify.get('/users/sessions', async (request, reply) => {
    const userId = request.user.userId
    const currentRefresh = request.cookies?.refreshToken
    const currentHash = currentRefresh ? hashToken(currentRefresh) : null
    const { rows } = await fastify.db.query(
      `SELECT id, token_hash, created_at, expires_at
       FROM refresh_tokens
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    )
    return {
      sessions: rows.map(s => ({
        id: s.id,
        created_at: s.created_at,
        expires_at: s.expires_at,
        is_current: currentHash ? currentHash === s.token_hash : false
      }))
    }
  })

  fastify.delete('/users/sessions/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const currentRefresh = request.cookies?.refreshToken
    const currentHash = currentRefresh ? hashToken(currentRefresh) : null
    const { rows } = await fastify.db.query(
      'SELECT token_hash FROM refresh_tokens WHERE id = $1 AND user_id = $2',
      [id, userId]
    )
    const lang = await getUserLang(fastify.db, userId)
    if (rows.length === 0) {
      reply.code(404)
      return { error: t('auth.session_not_found', {}, lang) }
    }
    if (currentHash && rows[0].token_hash === currentHash) {
      reply.code(400)
      return { error: t('auth.cannot_terminate_current', {}, lang) }
    }
    await fastify.db.query('DELETE FROM refresh_tokens WHERE id = $1 AND user_id = $2', [id, userId])
    return { success: true }
  })

  fastify.post('/users/logout-all', async (request, reply) => {
    const userId = request.user.userId
    const currentRefresh = request.cookies?.refreshToken
    if (currentRefresh) {
      const currentHash = hashToken(currentRefresh)
      await fastify.db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash != $2',
        [userId, currentHash]
      )
    } else {
      await fastify.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])
    }
    return { success: true }
  })

  fastify.post('/users/test-coingecko-key', {
    schema: {
      body: {
        type: 'object',
        required: ['coingecko_api_key'],
        properties: {
          coingecko_api_key: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const { coingecko_api_key } = request.body
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&x_cg_demo_api_key=${encodeURIComponent(coingecko_api_key)}`,
        { method: 'GET' }
      )
      if (res.ok) {
        return { valid: true }
      }
      if (res.status === 401 || res.status === 403) {
        reply.code(401)
        return { valid: false, error: 'Invalid API key' }
      }
      reply.code(502)
      return { valid: false, error: 'CoinGecko API error' }
    } catch (err) {
      fastify.log.warn(err, 'CoinGecko key test failed')
      reply.code(502)
      return { valid: false, error: 'Failed to reach CoinGecko' }
    }
  })

  fastify.post('/users/logout', async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken)
      await fastify.db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash])
    }
    reply.clearCookie(ACCESS_TOKEN_NAME, getCookieOptions(request, 0))
    reply.clearCookie(REFRESH_TOKEN_NAME, getCookieOptions(request, 0))
    return { success: true }
  })
}

export default authRoutes
