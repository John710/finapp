import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { OTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib'
import { buildStubDb } from './helpers/stub-db.js'

// plugins/auth.js validates JWT_SECRET when it is imported
const SECRET = vi.hoisted(() => {
  const secret = 'test-secret-9f8e7d6c5b4a3210-QWERTYUIOP-asdfghjkl'
  process.env.JWT_SECRET = secret
  return secret
})

// The routes hash with bcrypt cost 12 (password change/reset, the login dummy
// hash): slow enough under a parallel run to trip the default 5 s timeout.
vi.setConfig({ testTimeout: 30000 })

const { default: authPlugin } = await import('../plugins/auth.js')
const { default: authRoutes, REFRESH_CONSUME_SQL, TOTP_MAX_FAILURES, TOTP_LOCK_MINUTES } = await import('../routes/auth.js')
const { default: usersAdminRoutes } = await import('../routes/users_admin.js')

const USER_ID = 7
const PASSWORD = 'correct horse battery'
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4)
const otp = new OTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() })
const TOTP_SECRET = otp.generateSecret()
// Mid-period, so the generated code cannot roll over during a test
const NOW = new Date('2026-03-05T12:00:10Z')
const CURRENT_STEP = Math.floor(NOW.getTime() / 1000 / 30)

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterAll(() => {
  vi.useRealTimers()
})

function userRow(overrides = {}) {
  return {
    id: USER_ID,
    login: 'alice',
    role: 'user',
    language: 'en',
    password_hash: PASSWORD_HASH,
    base_currency: 'USD',
    totp_enabled: false,
    totp_secret: null,
    totp_last_step: null,
    totp_locked: false,
    ...overrides
  }
}

function buildApp(handlers = []) {
  const { db, queries } = buildStubDb(handlers)
  const app = Fastify()
  app.decorate('db', db)
  app.register(cookie)
  app.register(authPlugin)
  app.register(authRoutes, { prefix: '/api/v1' })
  app.register(usersAdminRoutes, { prefix: '/api/v1' })
  return { app, queries }
}

function accessToken(userId = USER_ID) {
  return jwt.sign({ userId, login: 'x', role: 'user', type: 'access' }, SECRET)
}

function refreshToken(userId = USER_ID) {
  return jwt.sign({ userId, type: 'refresh' }, SECRET, { expiresIn: '30d' })
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const ran = (queries, re) => queries.filter(q => re.test(q.sql))

describe('POST /auth/refresh', () => {
  function refreshApp(consumedRows) {
    return buildApp([
      { match: /FROM users WHERE id = \$1/, rows: [userRow()] },
      { match: /UPDATE refresh_tokens/, rows: () => consumedRows },
      { match: /INSERT INTO refresh_tokens/, rows: [] },
      { match: /DELETE FROM refresh_tokens/, rows: [] }
    ])
  }

  it('measures the grace window from the first consumption and never extends it', () => {
    const sql = REFRESH_CONSUME_SQL.replace(/\s+/g, ' ')
    // The window is anchored on consumed_at, which is only ever set once
    expect(sql).toContain('consumed_at = COALESCE(consumed_at, NOW())')
    expect(sql).toContain("LEAST(expires_at, COALESCE(consumed_at, NOW()) + INTERVAL '30 seconds')")
    expect(sql).toContain("consumed_at IS NULL OR consumed_at > NOW() - INTERVAL '30 seconds'")
    // The old statement pushed expiry forward on every reuse
    expect(sql).not.toMatch(/expires_at = NOW\(\) \+/)
  })

  it('rotates a token that is still consumable', async () => {
    const { app, queries } = refreshApp([{ id: 1 }])
    const token = refreshToken()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { refreshToken: token } })
    expect(res.statusCode).toBe(200)
    const consume = ran(queries, /UPDATE refresh_tokens/)[0]
    expect(consume.params).toEqual([USER_ID, sha256(token)])
    expect(ran(queries, /INSERT INTO refresh_tokens/)).toHaveLength(1)
    expect(ran(queries, /DELETE FROM refresh_tokens/)).toHaveLength(0)
  })

  it('revokes every session when the token is past its grace window', async () => {
    const { app, queries } = refreshApp([])
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { refreshToken: refreshToken() } })
    expect(res.statusCode).toBe(401)
    expect(ran(queries, /INSERT INTO refresh_tokens/)).toHaveLength(0)
    expect(ran(queries, /DELETE FROM refresh_tokens WHERE user_id = \$1/)[0].params).toEqual([USER_ID])
  })
})

describe('POST /auth/login', () => {
  function loginApp(user, { stepAccepted = true, lockedAfterFailure = false } = {}) {
    return buildApp([
      { match: /UPDATE users SET totp_last_step/, rows: () => (stepAccepted ? [{ id: USER_ID }] : []) },
      { match: /UPDATE users SET\s+totp_locked_until/, rows: () => [{ locked: lockedAfterFailure }] },
      { match: /FROM users WHERE login = \$1/, rows: () => (user ? [user] : []) },
      { match: /FROM users WHERE id = \$1/, rows: () => (user ? [user] : []) },
      { match: /INSERT INTO refresh_tokens/, rows: [] }
    ])
  }

  const login = (app, body) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: 'alice', password: PASSWORD, ...body } })
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))

  it('answers an unknown login exactly like a wrong password', async () => {
    const unknown = await login(loginApp(null).app, { password: 'wrong password' })
    const wrong = await login(loginApp(userRow({ language: 'ru' })).app, { password: 'wrong password' })
    expect(unknown.statusCode).toBe(401)
    expect(wrong.statusCode).toBe(401)
    // The account's language must not leak into the reply either
    expect(wrong.json()).toEqual(unknown.json())
  })

  it('accepts a valid code and records its time step', async () => {
    const code = await otp.generate({ secret: TOTP_SECRET })
    const { app, queries } = loginApp(userRow({ totp_enabled: true, totp_secret: TOTP_SECRET }))
    const res = await login(app, { totp_code: code })
    expect(res.statusCode).toBe(200)
    const accept = ran(queries, /UPDATE users SET totp_last_step/)[0]
    expect(accept.params).toEqual([USER_ID, CURRENT_STEP])
    expect(accept.sql).toContain('totp_last_step IS NULL OR totp_last_step < $2')
  })

  it('refuses a replayed code from an already accepted time step', async () => {
    const code = await otp.generate({ secret: TOTP_SECRET })
    const { app, queries } = loginApp(userRow({ totp_enabled: true, totp_secret: TOTP_SECRET, totp_last_step: String(CURRENT_STEP) }))
    const res = await login(app, { totp_code: code })
    expect(res.statusCode).toBe(401)
    expect(res.json().totp_required).toBe(true)
    expect(ran(queries, /UPDATE users SET totp_last_step/)).toHaveLength(0)
    expect(ran(queries, /totp_failed_attempts \+ 1/)).toHaveLength(1)
  })

  it('refuses the same code when a concurrent login already spent it', async () => {
    const code = await otp.generate({ secret: TOTP_SECRET })
    const { app, queries } = loginApp(userRow({ totp_enabled: true, totp_secret: TOTP_SECRET }), { stepAccepted: false })
    const res = await login(app, { totp_code: code })
    expect(res.statusCode).toBe(401)
    expect(ran(queries, /INSERT INTO refresh_tokens/)).toHaveLength(0)
  })

  it('counts a wrong code and locks after the limit', async () => {
    const { app, queries } = loginApp(userRow({ totp_enabled: true, totp_secret: TOTP_SECRET }), { lockedAfterFailure: true })
    const res = await login(app, { totp_code: '000000' })
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ totp_required: true, totp_locked: true })
    expect(res.headers['retry-after']).toBe(String(TOTP_LOCK_MINUTES * 60))
    const failure = ran(queries, /totp_failed_attempts \+ 1/)[0]
    expect(failure.params).toEqual([USER_ID, TOTP_MAX_FAILURES, TOTP_LOCK_MINUTES])
  })

  it('does not even check the code while locked', async () => {
    const code = await otp.generate({ secret: TOTP_SECRET })
    const { app, queries } = loginApp(userRow({ totp_enabled: true, totp_secret: TOTP_SECRET, totp_locked: true }))
    const res = await login(app, { totp_code: code })
    expect(res.statusCode).toBe(423)
    expect(ran(queries, /UPDATE users/)).toHaveLength(0)
  })

  it('notifies the owner about a wrong code after a correct password', async () => {
    const { app, queries } = loginApp(userRow({ totp_enabled: true, totp_secret: TOTP_SECRET }))
    const res = await login(app, { totp_code: '000000' })
    expect(res.statusCode).toBe(401)
    await settle()
    const dupCheck = ran(queries, /FROM notifications/)[0]
    expect(dupCheck.params.slice(0, 3)).toEqual([USER_ID, 'login_failed', 'totp:alice'])
  })
})

describe('POST /users/logout', () => {
  it('ends the session from the refresh cookie alone (expired access token)', async () => {
    const { app, queries } = buildApp([{ match: /DELETE FROM refresh_tokens/, rows: [] }])
    const token = refreshToken()
    const expiredAccess = jwt.sign({ userId: USER_ID, type: 'access', exp: Math.floor(NOW.getTime() / 1000) - 60 }, SECRET)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/logout',
      cookies: { refreshToken: token, accessToken: expiredAccess }
    })
    expect(res.statusCode).toBe(200)
    expect(ran(queries, /DELETE FROM refresh_tokens WHERE token_hash = \$1/)[0].params).toEqual([sha256(token)])
    const cleared = [res.headers['set-cookie']].flat().join(';')
    expect(cleared).toContain('refreshToken=;')
    expect(cleared).toContain('accessToken=;')
  })
})

describe('password length (bcrypt reads 72 bytes)', () => {
  const longPassword = 'ж'.repeat(40) // 40 characters, 80 UTF-8 bytes

  it('refuses it at registration', async () => {
    const { app, queries } = buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login: 'alice', password: longPassword } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/72 bytes/)
    expect(queries).toHaveLength(0)
  })

  it('accepts 72 bytes exactly', async () => {
    const { app } = buildApp([{ match: /SELECT 1 FROM users/, rows: [{ '?column?': 1 }] }])
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login: 'alice', password: 'ж'.repeat(36) } })
    // Past the length check: refused only because the instance already has a user
    expect(res.json().error).not.toMatch(/72 bytes/)
  })
})

describe('credential revocation', () => {
  it('a password change ends other sessions, API tokens and feed tokens', async () => {
    const { app, queries } = buildApp([{ match: /FROM users WHERE id = \$1/, rows: [userRow()] }])
    const refresh = refreshToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/change-password',
      headers: { authorization: `Bearer ${accessToken()}` },
      cookies: { refreshToken: refresh },
      payload: { current_password: PASSWORD, new_password: 'another long password' }
    })
    expect(res.statusCode).toBe(200)
    expect(ran(queries, /DELETE FROM refresh_tokens WHERE user_id = \$1 AND token_hash != \$2/)[0].params).toEqual([USER_ID, sha256(refresh)])
    expect(ran(queries, /DELETE FROM api_tokens WHERE user_id = \$1/)[0].params).toEqual([USER_ID])
    expect(ran(queries, /UPDATE recurring_feed_tokens SET revoked_at = NOW\(\)/)[0].params).toEqual([USER_ID])
  })

  function adminApp() {
    return buildApp([
      { match: /UPDATE users SET/, rows: [{ id: 9, login: 'bob', role: 'user', totp_enabled: false }] },
      { match: /FROM users WHERE id = \$1/, rows: [userRow({ id: 1, role: 'admin' })] }
    ])
  }

  it('an admin password reset ends every credential of the user', async () => {
    const { app, queries } = adminApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/9',
      headers: { authorization: `Bearer ${accessToken(1)}` },
      payload: { password: 'a brand new password' }
    })
    expect(res.statusCode).toBe(200)
    expect(ran(queries, /DELETE FROM refresh_tokens WHERE user_id = \$1/)[0].params).toEqual([9])
    expect(ran(queries, /DELETE FROM api_tokens WHERE user_id = \$1/)[0].params).toEqual([9])
    expect(ran(queries, /UPDATE recurring_feed_tokens SET revoked_at/)[0].params).toEqual([9])
  })

  it('an admin can reset a user\'s two-factor authentication', async () => {
    const { app, queries } = adminApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/9',
      headers: { authorization: `Bearer ${accessToken(1)}` },
      payload: { reset_2fa: true }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().totp_enabled).toBe(false)
    const update = ran(queries, /UPDATE users SET/)[0]
    for (const part of ['totp_enabled = false', 'totp_secret = NULL', 'totp_failed_attempts = 0', 'totp_locked_until = NULL', 'totp_last_step = NULL']) {
      expect(update.sql).toContain(part)
    }
    expect(update.params).toEqual([9])
    // Resetting 2FA alone does not revoke the user's credentials
    expect(ran(queries, /DELETE FROM api_tokens/)).toHaveLength(0)
  })

  it('a non-admin cannot reset anyone\'s two-factor authentication', async () => {
    const { app, queries } = buildApp([{ match: /FROM users WHERE id = \$1/, rows: [userRow()] }])
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/9',
      headers: { authorization: `Bearer ${accessToken()}` },
      payload: { reset_2fa: true }
    })
    expect(res.statusCode).toBe(403)
    expect(ran(queries, /UPDATE users/)).toHaveLength(0)
  })
})
