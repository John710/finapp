import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { buildStubDb } from './helpers/stub-db.js'

// plugins/auth.js validates JWT_SECRET when it is imported
const SECRET = vi.hoisted(() => {
  const secret = 'test-secret-9f8e7d6c5b4a3210-QWERTYUIOP-asdfghjkl'
  process.env.JWT_SECRET = secret
  return secret
})

const { default: authPlugin, jwtSecretProblem, JWT_SECRET_PLACEHOLDER, apiTokenForbidden, verifyAccessToken, verifyRefreshToken } =
  await import('../plugins/auth.js')

const USER_ID = 7
const API_TOKEN = 'a'.repeat(64)
const API_TOKEN_HASH = crypto.createHash('sha256').update(API_TOKEN).digest('hex')

function buildApp({ users = [{ id: USER_ID, login: 'alice', role: 'user', language: 'en' }], apiTokenUsers = [] } = {}) {
  const { db, queries } = buildStubDb([
    { match: /FROM api_tokens tok JOIN users/, rows: () => apiTokenUsers },
    { match: /UPDATE api_tokens SET last_used_at/, rows: [] },
    { match: /FROM users WHERE id = \$1/, rows: () => users }
  ])
  const app = Fastify()
  app.decorate('db', db)
  app.register(authPlugin)
  const echo = async request => ({ user: request.user })
  app.register(async scoped => {
    scoped.get('/accounts', echo)
    scoped.get('/users/tokens', echo)
    scoped.post('/users/tokens', echo)
    scoped.get('/recurring/feed-tokens', echo)
    scoped.get('/shares/:type/:id', echo)
    scoped.put('/shares/:type/:id', echo)
    scoped.get('/admin/users', echo)
    scoped.post('/admin/load-demo', echo)
  }, { prefix: '/api/v1' })
  return { app, queries }
}

function bearer(token) {
  return { authorization: `Bearer ${token}` }
}

describe('JWT_SECRET validation', () => {
  it('rejects a missing or short secret', () => {
    expect(jwtSecretProblem(undefined)).toMatch(/at least 32/)
    expect(jwtSecretProblem('short-secret')).toMatch(/at least 32/)
  })

  it('rejects the .env.example placeholder even though it is long enough', () => {
    expect(JWT_SECRET_PLACEHOLDER.length).toBeGreaterThanOrEqual(32)
    expect(jwtSecretProblem(JWT_SECRET_PLACEHOLDER)).toMatch(/placeholder/)
  })

  it('rejects a long but low-entropy secret', () => {
    expect(jwtSecretProblem('a'.repeat(64))).toMatch(/predictable/)
    expect(jwtSecretProblem('abcabcabc'.repeat(5))).toMatch(/predictable/)
  })

  it('accepts a random secret', () => {
    expect(jwtSecretProblem(crypto.randomBytes(32).toString('hex'))).toBeNull()
    expect(jwtSecretProblem(SECRET)).toBeNull()
  })
})

describe('token verification', () => {
  it('refuses a refresh token where an access token is expected', () => {
    const refresh = jwt.sign({ userId: USER_ID, type: 'refresh' }, SECRET, { expiresIn: '30d' })
    expect(() => verifyAccessToken(refresh)).toThrow(/type/)
    expect(verifyRefreshToken(refresh).userId).toBe(USER_ID)
  })

  it('refuses a token without a type claim as an access token', () => {
    const untyped = jwt.sign({ userId: USER_ID }, SECRET)
    expect(() => verifyAccessToken(untyped)).toThrow()
  })

  it('accepts only HS256', () => {
    const hs512 = jwt.sign({ userId: USER_ID, type: 'access' }, SECRET, { algorithm: 'HS512' })
    expect(() => verifyAccessToken(hs512)).toThrow(/invalid algorithm/)
    const hs512Refresh = jwt.sign({ userId: USER_ID, type: 'refresh' }, SECRET, { algorithm: 'HS512' })
    expect(() => verifyRefreshToken(hs512Refresh)).toThrow(/invalid algorithm/)
    const ok = jwt.sign({ userId: USER_ID, type: 'access' }, SECRET, { algorithm: 'HS256' })
    expect(verifyAccessToken(ok).userId).toBe(USER_ID)
  })
})

describe('auth hook', () => {
  it('rejects a refresh JWT presented as a bearer token', async () => {
    const { app } = buildApp()
    const refresh = jwt.sign({ userId: USER_ID, type: 'refresh' }, SECRET, { expiresIn: '30d' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: bearer(refresh) })
    expect(res.statusCode).toBe(401)
  })

  it('reads the role from the database, not from the token', async () => {
    const { app, queries } = buildApp({ users: [{ id: USER_ID, login: 'alice', role: 'user', language: 'en' }] })
    // Token minted while alice was still an admin
    const access = jwt.sign({ userId: USER_ID, login: 'alice', role: 'admin', type: 'access' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: bearer(access) })
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toEqual({ userId: USER_ID, login: 'alice', role: 'user', viaApiToken: false })
    expect(queries.some(q => /FROM users WHERE id = \$1/.test(q.sql) && q.params[0] === USER_ID)).toBe(true)
  })

  it('promotes on the next request once the database says admin', async () => {
    const { app } = buildApp({ users: [{ id: USER_ID, login: 'alice', role: 'admin', language: 'en' }] })
    const access = jwt.sign({ userId: USER_ID, login: 'alice', role: 'user', type: 'access' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: bearer(access) })
    expect(res.json().user.role).toBe('admin')
  })

  it('rejects a valid token of a deleted user', async () => {
    const { app } = buildApp({ users: [] })
    const access = jwt.sign({ userId: USER_ID, login: 'alice', role: 'admin', type: 'access' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: bearer(access) })
    expect(res.statusCode).toBe(401)
  })

  it('marks API-token requests and lets them read and write finance data', async () => {
    const { app, queries } = buildApp({ apiTokenUsers: [{ id: USER_ID, login: 'alice', role: 'admin', language: 'en' }] })
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: bearer(API_TOKEN) })
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toEqual({ userId: USER_ID, login: 'alice', role: 'admin', viaApiToken: true })
    expect(queries.find(q => /FROM api_tokens tok/.test(q.sql)).params).toEqual([API_TOKEN_HASH])
  })

  it.each([
    ['GET', '/api/v1/users/tokens'],
    ['POST', '/api/v1/users/tokens'],
    ['GET', '/api/v1/recurring/feed-tokens'],
    ['PUT', '/api/v1/shares/account/3'],
    ['GET', '/api/v1/admin/users'],
    ['POST', '/api/v1/admin/load-demo']
  ])('refuses an API token on %s %s with 403', async (method, url) => {
    const { app } = buildApp({ apiTokenUsers: [{ id: USER_ID, login: 'alice', role: 'admin', language: 'en' }] })
    const res = await app.inject({ method, url, headers: bearer(API_TOKEN) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/API token/)
  })

  it('still lets an API token read a share configuration', async () => {
    const { app } = buildApp({ apiTokenUsers: [{ id: USER_ID, login: 'alice', role: 'user', language: 'en' }] })
    const res = await app.inject({ method: 'GET', url: '/api/v1/shares/account/3', headers: bearer(API_TOKEN) })
    expect(res.statusCode).toBe(200)
  })

  it('lets a browser session reach the routes an API token may not', async () => {
    const { app } = buildApp({ users: [{ id: USER_ID, login: 'alice', role: 'admin', language: 'en' }] })
    const access = jwt.sign({ userId: USER_ID, login: 'alice', role: 'admin', type: 'access' }, SECRET)
    const res = await app.inject({ method: 'PUT', url: '/api/v1/shares/account/3', headers: bearer(access) })
    expect(res.statusCode).toBe(200)
  })
})

describe('apiTokenForbidden', () => {
  it('matches route patterns, not concrete urls', () => {
    expect(apiTokenForbidden('DELETE', '/api/v1/users/tokens/:id')).toBe(true)
    expect(apiTokenForbidden('POST', '/api/v1/recurring/feed-tokens')).toBe(true)
    expect(apiTokenForbidden('POST', '/api/v1/admin/clear-database')).toBe(true)
    expect(apiTokenForbidden('PUT', '/api/v1/shares/:entityType/:entityId')).toBe(true)
    expect(apiTokenForbidden('GET', '/api/v1/shares/:entityType/:entityId')).toBe(false)
    expect(apiTokenForbidden('POST', '/api/v1/transactions')).toBe(false)
    expect(apiTokenForbidden('GET', '/api/v1/users/directory')).toBe(false)
  })
})
