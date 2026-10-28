import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { OTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib'
import QRCode from 'qrcode'
import { notify, checkDuplicateNotification } from '../services/notify.js'
import { t, getUserLang, getReqLang } from '../services/i18n.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { passwordTooLong, revokeUserCredentials } from '../services/credentials.js'

// otplib v13 (verified against current docs via Context7): the OTP class with
// explicit plugins replaced the old authenticator singleton. verify() takes
// {secret, token, afterTimeStep?} and returns a VerifyResult object whose
// timeStep is the RFC 6238 counter of the matched code; generateURI() builds
// the otpauth:// URL for the QR code.
const otpCrypto = new NobleCryptoPlugin()
const otpBase32 = new ScureBase32Plugin()

// Returns the matched time step, or null when the code is wrong. With
// `afterTimeStep` set, codes from that step or earlier are rejected (replay).
export async function verifyTotp(secret, token, afterTimeStep = null) {
  try {
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const options = { secret, token: String(token || '').trim() }
    if (afterTimeStep !== null && afterTimeStep !== undefined) {
      options.afterTimeStep = Number(afterTimeStep)
    }
    const result = await otp.verify(options)
    return result?.valid ? result.timeStep : null
  } catch {
    // otplib throws on a malformed secret, or when afterTimeStep lies ahead of
    // the current step (clock moved back): both mean "not accepted".
    return null
  }
}

// Consecutive wrong second-factor codes before the account's TOTP check locks.
export const TOTP_MAX_FAILURES = 5
export const TOTP_LOCK_MINUTES = 15

// Rate limits of the credential-checking routes. Each route-level config gets a
// counter of its own (see server.js), separate from the general API limit.
const CREDENTIAL_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }

// Consumes a refresh token for rotation in one statement (the row lock makes
// concurrent refreshes safe). A fresh token is stamped consumed_at = NOW() and
// its expiry cut to 30 seconds later; a token already consumed passes only
// while still inside 30 seconds of its FIRST consumption, and a reuse never
// moves consumed_at or expires_at forward. In SET, column references read the
// row's values from before the update.
export const REFRESH_GRACE_SECONDS = 30
export const REFRESH_CONSUME_SQL = `UPDATE refresh_tokens
  SET consumed_at = COALESCE(consumed_at, NOW()),
      expires_at = LEAST(expires_at, COALESCE(consumed_at, NOW()) + INTERVAL '${REFRESH_GRACE_SECONDS} seconds')
  WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
    AND (consumed_at IS NULL OR consumed_at > NOW() - INTERVAL '${REFRESH_GRACE_SECONDS} seconds')
  RETURNING id`

// bcrypt hash (same cost as real ones) of a random string. A login for an
// unknown user, or a user without a password, is compared against it so the
// response time does not reveal which logins exist.
let dummyHashPromise = null
function dummyPasswordHash() {
  dummyHashPromise ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12)
  return dummyHashPromise
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

  // Computed at registration so the first unknown-login request is not slower.
  dummyPasswordHash()

  // Security notifications must never delay or fail the login response: the
  // duplicate check and the push/shoutrrr delivery run in the background.
  function notifyInBackground(userId, lang, { entityId, titleKey, bodyKey, params }) {
    const type = 'login_failed'
    ;(async () => {
      const dup = await checkDuplicateNotification(fastify, { userId, type, entityId, hours: 1 })
      if (dup) return
      await notify(fastify, userId, {
        type,
        title: t(titleKey, {}, lang),
        message: t(bodyKey, params, lang),
        data: { entity_id: entityId, url: '/settings' },
        channels: ['push', 'shoutrrr']
      })
    })().catch(err => fastify.log.warn(err, 'Security notification error'))
  }

  // Second-factor check shared by login and 2FA disable. It refuses a code
  // whose time step was already accepted (replay), counts consecutive wrong
  // codes and locks the check for TOTP_LOCK_MINUTES after TOTP_MAX_FAILURES,
  // and tells the owner about wrong codes: one that follows a correct password
  // means somebody knows the password.
  // `user` needs id, login, language, totp_secret, totp_last_step, totp_locked.
  // Returns 'ok', 'invalid' or 'locked'.
  async function checkUserTotp(user, code, ip) {
    if (user.totp_locked) return 'locked'
    const secret = decrypt(user.totp_secret)
    const step = secret ? await verifyTotp(secret, code, user.totp_last_step) : null
    if (step !== null) {
      // Conditional on the stored step: two concurrent requests carrying the
      // same code cannot both pass.
      const accepted = await fastify.db.query(
        `UPDATE users SET totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL
         WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
         RETURNING id`,
        [user.id, step]
      )
      if (accepted.rowCount > 0) return 'ok'
    }
    const { rows } = await fastify.db.query(
      `UPDATE users SET
         totp_locked_until = CASE WHEN totp_failed_attempts + 1 >= $2
           THEN NOW() + make_interval(mins => $3) ELSE totp_locked_until END,
         totp_failed_attempts = CASE WHEN totp_failed_attempts + 1 >= $2
           THEN 0 ELSE totp_failed_attempts + 1 END
       WHERE id = $1
       RETURNING (totp_locked_until IS NOT NULL AND totp_locked_until > NOW()) AS locked`,
      [user.id, TOTP_MAX_FAILURES, TOTP_LOCK_MINUTES]
    )
    const locked = Boolean(rows[0]?.locked)
    fastify.log.warn({ userId: user.id, ip, reason: locked ? 'totp_locked' : 'invalid_totp' }, 'Second factor rejected')
    notifyInBackground(user.id, user.language || process.env.DEFAULT_LANG || 'en', {
      entityId: `totp:${user.login}`,
      titleKey: 'notifications.totp_failed',
      bodyKey: 'notifications.totp_failed_body',
      params: { login: user.login, ip: ip || 'unknown' }
    })
    return locked ? 'locked' : 'invalid'
  }

  function totpLockedReply(reply, lang) {
    reply.code(423)
    reply.header('Retry-After', String(TOTP_LOCK_MINUTES * 60))
    return { error: t('auth.totp_locked', { minutes: TOTP_LOCK_MINUTES }, lang), totp_required: true, totp_locked: true }
  }

  fastify.post('/auth/register', {
    config: { public: true, rateLimit: CREDENTIAL_RATE_LIMIT },
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
    if (passwordTooLong(password)) {
      reply.code(400)
      return { error: t('auth.password_too_long', {}, language || process.env.DEFAULT_LANG || 'en') }
    }
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
    config: { public: true, rateLimit: CREDENTIAL_RATE_LIMIT },
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
    const result = await fastify.db.query(
      `SELECT *, (totp_locked_until IS NOT NULL AND totp_locked_until > NOW()) AS totp_locked
       FROM users WHERE login = $1`,
      [login]
    )
    const user = result.rows[0]

    // Every failed branch costs one query plus one bcrypt comparison, so the
    // response time does not tell an unknown login from a wrong password.
    if (!user?.password_hash) {
      await bcrypt.compare(password, await dummyPasswordHash())
      fastify.log.warn({ login, userId: user?.id, ip: request.ip, reason: user ? 'no_password_hash' : 'user_not_found' }, 'Login failed')
      reply.code(401)
      return { error: t('auth.invalid_credentials', {}, lang) }
    }
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      fastify.log.warn({ login, userId: user.id, ip: request.ip, reason: 'invalid_password' }, 'Login failed')
      notifyInBackground(user.id, user.language || lang, {
        entityId: login,
        titleKey: 'notifications.login_failed',
        bodyKey: 'notifications.login_failed_body',
        params: { login, ip: request.ip || 'unknown' }
      })
      reply.code(401)
      // Request language, not the account's: a reply in the account's language
      // would itself reveal that the login exists.
      return { error: t('auth.invalid_credentials', {}, lang) }
    }

    // Second factor: when TOTP is enabled the login must present a valid code.
    // The first response without a code carries totp_required so the client
    // can show the code input and retry.
    if (user.totp_enabled) {
      const code = request.body?.totp_code
      if (user.totp_locked) {
        return totpLockedReply(reply, lang)
      }
      if (!code) {
        reply.code(401)
        return { error: t('auth.totp_required', {}, lang), totp_required: true }
      }
      const verdict = await checkUserTotp(user, code, request.ip)
      if (verdict === 'locked') {
        return totpLockedReply(reply, lang)
      }
      if (verdict !== 'ok') {
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
      // detection and revoking every session. The grace window is counted from
      // the FIRST consumption (consumed_at) and is never extended by a reuse.
      // A token presented BEYOND the grace window is treated as stolen: all
      // sessions are revoked.
      let rotated = false
      const client = await fastify.db.connect()
      try {
        await client.query('BEGIN')
        const consumed = await client.query(REFRESH_CONSUME_SQL, [payload.userId, tokenHash])
        if (consumed.rowCount > 0) {
          await client.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [user.id, newRefreshTokenHash, refreshExpires]
          )
          rotated = true
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
    config: { rateLimit: CREDENTIAL_RATE_LIMIT },
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
    if (passwordTooLong(new_password)) {
      reply.code(400)
      return { error: t('auth.password_too_long', {}, lang) }
    }
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
    // Hash update and revocation must land together: a crash between the two
    // would leave orphaned sessions valid with the old password's authority.
    // Other sessions, personal API tokens and calendar feed tokens all go; only
    // this browser session survives.
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId])
      await revokeUserCredentials(client, userId, { keepRefreshHash: currentHash })
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
       WHERE user_id = $1 AND expires_at > NOW() AND consumed_at IS NULL
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

  // Public on purpose: logout must work with an expired (or missing) access
  // token, otherwise the refresh row survives and the cookies stay set. The
  // refresh cookie alone identifies the session to end; deleting by its hash
  // can only ever remove the session that cookie belongs to.
  fastify.post('/users/logout', { config: { public: true } }, async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken
    let userId = null
    if (refreshToken) {
      try {
        userId = fastify.verifyRefreshToken(refreshToken).userId
      } catch {
        // Expired or invalid: the row (if any) is still removed below
      }
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
    config: { rateLimit: CREDENTIAL_RATE_LIMIT },
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
    await fastify.db.query(
      `UPDATE users SET totp_secret = $1, totp_last_step = NULL, totp_failed_attempts = 0, totp_locked_until = NULL
       WHERE id = $2`,
      [encrypt(secret), userId]
    )
    const otpauthUrl = otp.generateURI({ issuer: 'FinApp', label: user.login || 'finapp', secret })
    const qr = await QRCode.toDataURL(otpauthUrl)
    return { secret, otpauth_url: otpauthUrl, qr }
  })

  fastify.post('/users/2fa/enable', {
    config: { rateLimit: CREDENTIAL_RATE_LIMIT },
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
    const { rows } = await fastify.db.query('SELECT totp_secret, totp_last_step FROM users WHERE id = $1', [userId])
    const secret = decrypt(rows[0]?.totp_secret)
    if (!secret) {
      reply.code(400)
      return { error: t('errors.totp_not_setup', {}, lang) }
    }
    const step = await verifyTotp(secret, request.body.code, rows[0].totp_last_step)
    if (step === null) {
      reply.code(400)
      return { error: t('auth.invalid_totp_code', {}, lang) }
    }
    // The confirming code is spent: it cannot be replayed at the next login.
    await fastify.db.query(
      `UPDATE users SET totp_enabled = true, totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL
       WHERE id = $1`,
      [userId, step]
    )
    return { success: true }
  })

  fastify.post('/users/2fa/disable', {
    config: { rateLimit: CREDENTIAL_RATE_LIMIT },
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
    const { rows } = await fastify.db.query(
      `SELECT id, login, language, password_hash, totp_secret, totp_last_step,
              (totp_locked_until IS NOT NULL AND totp_locked_until > NOW()) AS totp_locked
       FROM users WHERE id = $1`,
      [userId]
    )
    const user = rows[0]
    if (!user || !(await bcrypt.compare(request.body.password, user.password_hash))) {
      reply.code(401)
      return { error: t('auth.invalid_current_password', {}, lang) }
    }
    // Same lockout, replay protection and owner notification as at login
    const verdict = await checkUserTotp(user, request.body.code, request.ip)
    if (verdict === 'locked') {
      return totpLockedReply(reply, lang)
    }
    if (verdict !== 'ok') {
      reply.code(400)
      return { error: t('auth.invalid_totp_code', {}, lang) }
    }
    await fastify.db.query(
      `UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL,
              totp_failed_attempts = 0, totp_locked_until = NULL
       WHERE id = $1`,
      [userId]
    )
    return { success: true }
  })

}

export default authRoutes
