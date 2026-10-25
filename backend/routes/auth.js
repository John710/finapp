import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { OTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib'
import QRCode from 'qrcode'
import { notify, checkDuplicateNotification } from '../services/notify.js'
import { t, getUserLang, getReqLang } from '../services/i18n.js'
import { encrypt, decrypt } from '../services/crypto.js'

// otplib v13 (verified against current docs via Context7): the OTP class with
// explicit plugins replaced the old authenticator singleton. verify() takes
// {secret, token} and returns a VerifyResult object; generateURI() builds the
// otpauth:// URL for the QR code.
const otpCrypto = new NobleCryptoPlugin()
const otpBase32 = new ScureBase32Plugin()

async function verifyTotp(secret, token) {
  try {
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const result = await otp.verify({ secret, token: String(token || '').trim() })
    return Boolean(result?.valid)
  } catch {
    return false
  }
}

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

// Secrets (shoutrrr urls embed tokens, coingecko keys are paid) are never
// returned to the client in full — only a masked preview plus a *_set flag.
const MASK = '\u2022\u2022\u2022\u2022'
function maskSecret(value) {
  if (!value) return null
  const str = String(value)
  return str.length <= 4 ? MASK : MASK + str.slice(-4)
}
function isMaskedSecret(value) {
  return typeof value === 'string' && value.startsWith(MASK)
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
          login: { type: 'string', minLength: 3, maxLength: 64 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
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
        // Registration is only open until the first user exists (initial setup).
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('auth.registration_closed', {}, language || process.env.DEFAULT_LANG || 'en') }
      }

      const hash = await bcrypt.hash(password, 12)
      // Registration is open only for the first user — they become the admin
      // (the role column default is 'user' since migration 30)
      await client.query(
        'INSERT INTO users (login, password_hash, language, role) VALUES ($1, $2, $3, $4)',
        [login, hash, language || process.env.DEFAULT_LANG || 'en', 'admin']
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
          login: { type: 'string', maxLength: 64 },
          password: { type: 'string', maxLength: 128 },
          totp_code: { type: 'string', maxLength: 8 },
          language: { type: 'string', default: 'en' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password } = request.body
    const lang = getReqLang(request)
    fastify.log.info({ login, ip: request.ip }, 'Login attempt')
    const result = await fastify.db.query('SELECT * FROM users WHERE login = $1', [login])
    if (result.rows.length === 0) {
      fastify.log.warn({ login, ip: request.ip, reason: 'user_not_found' }, 'Login failed')
      reply.code(401)
      return { error: t('auth.invalid_credentials', {}, lang) }
    }

    const user = result.rows[0]
    if (!user.password_hash) {
      fastify.log.warn({ login, userId: user.id, ip: request.ip, reason: 'no_password_hash' }, 'Login failed')
      reply.code(401)
      return { error: t('auth.invalid_credentials', {}, lang) }
    }
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      fastify.log.warn({ login, userId: user.id, ip: request.ip, reason: 'invalid_password' }, 'Login failed')
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

    // Second factor: when TOTP is enabled the login must present a valid code.
    // The first response without a code carries totp_required so the client
    // can show the code input and retry.
    if (user.totp_enabled) {
      const secret = decrypt(user.totp_secret)
      const code = request.body?.totp_code
      if (!code) {
        reply.code(401)
        return { error: t('auth.totp_required', {}, lang), totp_required: true }
      }
      if (!secret || !(await verifyTotp(secret, code))) {
        reply.code(401)
        return { error: t('auth.invalid_totp_code', {}, lang), totp_required: true }
      }
    }

    fastify.log.info({ userId: user.id, login, ip: request.ip }, 'Login successful')

    const tokenPayload = { userId: user.id, login: user.login, role: user.role || 'user' }
    const accessToken = fastify.signAccessToken(tokenPayload)
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
        role: user.role || 'user',
        language: user.language,
        base_currency: user.base_currency,
        coingecko_api_key: maskSecret(decrypt(user.coingecko_api_key)),
        coingecko_api_key_set: Boolean(user.coingecko_api_key),
        shoutrrr_url: maskSecret(decrypt(user.shoutrrr_url)),
        shoutrrr_url_set: Boolean(user.shoutrrr_url),
        vapid_public_key: user.vapid_public_key,
        vapid_subject: user.vapid_subject,
        avatar_set: Boolean(user.avatar),
      totp_enabled: Boolean(user.totp_enabled)
      }
    }
  })

  fastify.post('/auth/refresh', { config: { public: true } }, async (request, reply) => {
    const lang = getReqLang(request)
    const refreshToken = request.cookies?.refreshToken
    if (!refreshToken) {
      fastify.log.warn({ ip: request.ip, reason: 'missing_refresh_token' }, 'Refresh failed')
      reply.code(401)
      return { error: t('auth.no_refresh_token', {}, lang) }
    }

    try {
      const payload = fastify.verifyRefreshToken(refreshToken)
      const tokenHash = hashToken(refreshToken)
      const result = await fastify.db.query('SELECT * FROM users WHERE id = $1', [payload.userId])
      if (result.rows.length === 0) {
        fastify.log.warn({ userId: payload.userId, ip: request.ip, reason: 'user_not_found' }, 'Refresh failed')
        reply.code(401)
        return { error: t('auth.user_not_found', {}, lang) }
      }

      const user = result.rows[0]

      const newAccessToken = fastify.signAccessToken({ userId: user.id, login: user.login, role: user.role || 'user' })
      const newRefreshToken = fastify.signRefreshToken({ userId: user.id })
      const newRefreshTokenHash = hashToken(newRefreshToken)
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      // Rotate the refresh token atomically: check, consume and replace happen
      // in one transaction. The old token is NOT deleted — it keeps a 30-second
      // grace validity so a second browser tab refreshing at the same moment is
      // benign (each gets its own new token) instead of tripping replay
      // detection and revoking every session. A token consumed BEYOND the grace
      // window is still treated as stolen: all sessions are revoked.
      let rotated = false
      const client = await fastify.db.connect()
      try {
        await client.query('BEGIN')
        const tokenRes = await client.query(
          'SELECT id FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()',
          [payload.userId, tokenHash]
        )
        if (tokenRes.rows.length > 0) {
          const consumed = await client.query(
            'UPDATE refresh_tokens SET expires_at = NOW() + INTERVAL \'30 seconds\' WHERE id = $1 AND user_id = $2 RETURNING id',
            [tokenRes.rows[0].id, payload.userId]
          )
          if (consumed.rowCount > 0) {
            await client.query(
              'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
              [user.id, newRefreshTokenHash, refreshExpires]
            )
            rotated = true
          }
        }
        await client.query(rotated ? 'COMMIT' : 'ROLLBACK')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }

      if (!rotated) {
        // The presented token was already used or is unknown → possible replay:
        // revoke every session of this user.
        await fastify.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [payload.userId])
        fastify.log.warn({ userId: payload.userId, ip: request.ip, reason: 'invalid_refresh_token' }, 'Refresh failed')
        reply.code(401)
        return { error: t('auth.invalid_refresh_token', {}, lang) }
      }

      fastify.log.info({ userId: user.id, ip: request.ip }, 'Token refreshed')
      reply.setCookie(ACCESS_TOKEN_NAME, newAccessToken, getCookieOptions(request, 15 * 60 * 1000))
      reply.setCookie(REFRESH_TOKEN_NAME, newRefreshToken, getCookieOptions(request, 30 * 24 * 60 * 60 * 1000))

      return {
        user: {
          id: user.id,
          login: user.login,
          role: user.role || 'user',
          language: user.language,
          base_currency: user.base_currency,
          coingecko_api_key: maskSecret(decrypt(user.coingecko_api_key)),
          coingecko_api_key_set: Boolean(user.coingecko_api_key),
          shoutrrr_url: maskSecret(decrypt(user.shoutrrr_url)),
          shoutrrr_url_set: Boolean(user.shoutrrr_url),
          vapid_public_key: user.vapid_public_key,
          vapid_subject: user.vapid_subject,
          avatar_set: Boolean(user.avatar),
          totp_enabled: Boolean(user.totp_enabled)
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
          shoutrrr_url: { type: ['string', 'null'], maxLength: 2048 },
          avatar: { type: ['string', 'null'], maxLength: 700000 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    try {
      const { language, base_currency, coingecko_api_key, shoutrrr_url, avatar } = request.body
      const fields = []
      const values = []
      let idx = 1
      if (language !== undefined) { fields.push(`language = $${idx++}`); values.push(language) }
      if (base_currency !== undefined) { fields.push(`base_currency = $${idx++}`); values.push(base_currency) }
      // The avatar is a raster-image data URL (or null to remove). SVG is
      // rejected on purpose: stored SVG can execute script in some contexts.
      if (avatar !== undefined) {
        const valid = avatar === null
          || (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar.length <= 700000)
        if (!valid) {
          reply.code(400)
          return { error: t('errors.avatar_invalid', {}, lang) }
        }
        fields.push(`avatar = $${idx++}`)
        values.push(avatar)
      }
      // Masked previews sent back by the client mean "keep the stored value"
      if (coingecko_api_key !== undefined && !isMaskedSecret(coingecko_api_key)) { fields.push(`coingecko_api_key = $${idx++}`); values.push(encrypt((coingecko_api_key || '').trim() || null)) }
      if (shoutrrr_url !== undefined && !isMaskedSecret(shoutrrr_url)) { fields.push(`shoutrrr_url = $${idx++}`); values.push(encrypt((shoutrrr_url || '').trim() || null)) }
      if (fields.length === 0) return { success: false, error: t('errors.no_fields_to_update', {}, lang) }
      values.push(userId)
      await fastify.db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values)
      return { success: true }
    } catch (err) {
      fastify.log.warn(err, 'Failed to update user settings')
      if (err.message?.includes('ENCRYPTION_KEY')) {
        reply.code(400)
        return { error: t('errors.encryption_key_missing', {}, lang) }
      }
      reply.code(500)
      return { error: t('errors.failed_to_save_settings', {}, lang) }
    }
  })

  fastify.get('/users/me', async (request, reply) => {
    const lang = await getUserLang(fastify.db, request.user.userId)
    const result = await fastify.db.query(
      `SELECT id, login, language, base_currency, coingecko_api_key,
              shoutrrr_url, vapid_public_key, vapid_subject, avatar, totp_enabled
       FROM users WHERE id = $1`,
      [request.user.userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('auth.user_not_found', {}, lang) }
    }
    const user = result.rows[0]
    return {
      id: user.id,
      login: user.login,
      language: user.language,
      base_currency: user.base_currency,
      coingecko_api_key: maskSecret(decrypt(user.coingecko_api_key)),
      coingecko_api_key_set: Boolean(user.coingecko_api_key),
      shoutrrr_url: maskSecret(decrypt(user.shoutrrr_url)),
      shoutrrr_url_set: Boolean(user.shoutrrr_url),
      vapid_public_key: user.vapid_public_key,
      vapid_subject: user.vapid_subject,
      avatar_set: Boolean(user.avatar),
      totp_enabled: Boolean(user.totp_enabled)
    }
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
          current_password: { type: 'string', maxLength: 128 },
          new_password: { type: 'string', minLength: 8, maxLength: 128 }
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
      fastify.log.warn({ userId, ip: request.ip, reason: 'invalid_current_password' }, 'Password change failed')
      reply.code(401)
      return { error: t('auth.invalid_current_password', {}, lang) }
    }

    // Validate the browser session BEFORE mutating anything: without a refresh
    // cookie we cannot keep this session alive, and the password must not change.
    const currentRefresh = request.cookies?.refreshToken
    if (!currentRefresh) {
      reply.code(400)
      return { error: t('auth.session_required_for_password_change', {}, lang) }
    }

    const newHash = await bcrypt.hash(new_password, 12)
    const currentHash = hashToken(currentRefresh)
    // Hash update and session revocation must land together: a crash between
    // the two would leave orphaned sessions valid with the old password's authority.
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId])
      await client.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash != $2',
        [userId, currentHash]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    fastify.log.info({ userId, ip: request.ip }, 'Password changed')

    return { success: true }
  })

  fastify.get('/users/me/avatar', async (request, reply) => {
    const { rows } = await fastify.db.query('SELECT avatar FROM users WHERE id = $1', [request.user.userId])
    const avatar = rows[0]?.avatar
    const match = avatar ? avatar.match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/) : null
    if (!match) {
      reply.code(404)
      return { error: t('errors.avatar_not_found', {}, await getUserLang(fastify.db, request.user.userId)) }
    }
    const etag = crypto.createHash('md5').update(avatar).digest('hex')
    reply.header('ETag', `"${etag}"`)
    // no-cache = always revalidate with the ETag: an avatar change is picked
    // up immediately, unchanged avatars answer with a cheap 304
    reply.header('Cache-Control', 'private, no-cache')
    reply.header('Content-Type', match[1])
    return Buffer.from(match[2], 'base64')
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
        properties: {
          coingecko_api_key: { type: 'string', maxLength: 255 }
        }
      }
    }
  }, async (request, reply) => {
    const lang = await getUserLang(fastify.db, request.user.userId)
    let { coingecko_api_key } = request.body || {}
    // The UI shows a masked preview of the stored key; when the mask (or
    // nothing) comes back, test the STORED secret instead of the literal input.
    if (!coingecko_api_key || isMaskedSecret(coingecko_api_key)) {
      const { rows } = await fastify.db.query('SELECT coingecko_api_key FROM users WHERE id = $1', [request.user.userId])
      coingecko_api_key = decrypt(rows[0]?.coingecko_api_key)
      if (!coingecko_api_key) {
        reply.code(400)
        return { valid: false, error: t('errors.no_api_key_configured', {}, lang) }
      }
    }
    try {
      // The key travels in a header, not in the URL (URLs end up in proxy logs)
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
        { method: 'GET', headers: { 'x-cg-demo-api-key': coingecko_api_key }, signal: AbortSignal.timeout(10000) }
      )
      if (res.ok) {
        return { valid: true }
      }
      if (res.status === 401 || res.status === 403) {
        reply.code(401)
        return { valid: false, error: t('errors.invalid_api_key', {}, lang) }
      }
      reply.code(502)
      return { valid: false, error: t('errors.coingecko_error', {}, lang) }
    } catch (err) {
      fastify.log.warn(err, 'CoinGecko key test failed')
      reply.code(502)
      return { valid: false, error: t('errors.coingecko_unreachable', {}, lang) }
    }
  })

  fastify.post('/users/logout', async (request, reply) => {
    const userId = request.user.viewerUserId || request.user.userId
    const refreshToken = request.cookies?.refreshToken
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken)
      await fastify.db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash])
    }
    reply.clearCookie(ACCESS_TOKEN_NAME, getCookieOptions(request, 0))
    reply.clearCookie(REFRESH_TOKEN_NAME, getCookieOptions(request, 0))
    fastify.log.info({ userId, ip: request.ip }, 'Logout successful')
    return { success: true }
  })

  // ---------- Two-factor authentication (TOTP) ----------

  fastify.post('/users/2fa/setup', {
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', maxLength: 128 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { rows } = await fastify.db.query('SELECT login, password_hash, totp_enabled FROM users WHERE id = $1', [userId])
    const user = rows[0]
    if (!user || !(await bcrypt.compare(request.body.password, user.password_hash))) {
      reply.code(401)
      return { error: t('auth.invalid_current_password', {}, lang) }
    }
    if (user.totp_enabled) {
      reply.code(400)
      return { error: t('errors.totp_already_enabled', {}, lang) }
    }
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const secret = otp.generateSecret()
    await fastify.db.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [encrypt(secret), userId])
    const otpauthUrl = otp.generateURI({ issuer: 'FinApp', label: user.login || 'finapp', secret })
    const qr = await QRCode.toDataURL(otpauthUrl)
    return { secret, otpauth_url: otpauthUrl, qr }
  })

  fastify.post('/users/2fa/enable', {
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 6, maxLength: 8 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { rows } = await fastify.db.query('SELECT totp_secret FROM users WHERE id = $1', [userId])
    const secret = decrypt(rows[0]?.totp_secret)
    if (!secret) {
      reply.code(400)
      return { error: t('errors.totp_not_setup', {}, lang) }
    }
    if (!(await verifyTotp(secret, request.body.code))) {
      reply.code(400)
      return { error: t('auth.invalid_totp_code', {}, lang) }
    }
    await fastify.db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [userId])
    return { success: true }
  })

  fastify.post('/users/2fa/disable', {
    schema: {
      body: {
        type: 'object',
        required: ['password', 'code'],
        properties: {
          password: { type: 'string', maxLength: 128 },
          code: { type: 'string', minLength: 6, maxLength: 8 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { rows } = await fastify.db.query('SELECT password_hash, totp_secret FROM users WHERE id = $1', [userId])
    const user = rows[0]
    if (!user || !(await bcrypt.compare(request.body.password, user.password_hash))) {
      reply.code(401)
      return { error: t('auth.invalid_current_password', {}, lang) }
    }
    const secret = decrypt(user.totp_secret)
    if (!secret || !(await verifyTotp(secret, request.body.code))) {
      reply.code(400)
      return { error: t('auth.invalid_totp_code', {}, lang) }
    }
    await fastify.db.query('UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [userId])
    return { success: true }
  })

}

export default authRoutes
