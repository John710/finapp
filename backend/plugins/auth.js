import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { t } from '../services/i18n.js'

const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m'
const JWT_REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d'
// Only the algorithm we sign with is accepted on verify.
const JWT_ALGORITHMS = ['HS256']

// The value shipped in .env.example. It is long enough to pass a length check,
// so instances that copied it verbatim would accept tokens anyone can forge.
export const JWT_SECRET_PLACEHOLDER = 'change-me-to-a-random-string-at-least-32-chars'
const JWT_SECRET_MIN_LENGTH = 32
// A random hex secret has 16 distinct characters, base64 far more. Kept at 8 so
// the CI stack's fixed secret (9 distinct characters) still boots.
const JWT_SECRET_MIN_DISTINCT = 8

// Returns a reason the secret is unusable, or null when it is acceptable.
export function jwtSecretProblem(secret) {
  if (!secret || secret.length < JWT_SECRET_MIN_LENGTH) {
    return `JWT_SECRET is required and must be at least ${JWT_SECRET_MIN_LENGTH} characters`
  }
  if (secret === JWT_SECRET_PLACEHOLDER) {
    return 'JWT_SECRET still holds the placeholder from .env.example; generate a random one (e.g. openssl rand -hex 32)'
  }
  if (new Set(secret).size < JWT_SECRET_MIN_DISTINCT) {
    return `JWT_SECRET is too predictable (fewer than ${JWT_SECRET_MIN_DISTINCT} distinct characters); generate a random one (e.g. openssl rand -hex 32)`
  }
  return null
}

const JWT_SECRET = process.env.JWT_SECRET
const secretProblem = jwtSecretProblem(JWT_SECRET)
if (secretProblem) {
  throw new Error(secretProblem)
}

// Personal API tokens are 64 hex chars; JWTs contain dots
function looksLikeApiToken(token) {
  return /^[0-9a-f]{64}$/.test(token)
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// A personal API token is meant for scripts reading and writing finance data.
// It must not mint or revoke credentials, change who can see the owner's data,
// or reach admin/maintenance endpoints: a leaked token would otherwise be a
// full account takeover. `routeUrl` is the matched route pattern.
export function apiTokenForbidden(method, routeUrl) {
  const url = String(routeUrl || '')
  if (url.startsWith('/api/v1/users/tokens')) return true
  if (url.startsWith('/api/v1/recurring/feed-tokens')) return true
  if (url.startsWith('/api/v1/admin/')) return true
  if (url.startsWith('/api/v1/shares/') && method !== 'GET' && method !== 'HEAD') return true
  return false
}

export function verifyAccessToken(token, secret = JWT_SECRET) {
  const payload = jwt.verify(token, secret, { algorithms: JWT_ALGORITHMS })
  // A refresh token is signed with the same secret: without this check a
  // 30-day refresh JWT would work as a bearer token and survive logout.
  if (payload?.type !== 'access') {
    throw new Error('Invalid token type')
  }
  return payload
}

export function verifyRefreshToken(token, secret = JWT_SECRET) {
  const payload = jwt.verify(token, secret, { algorithms: JWT_ALGORITHMS })
  // Backward compatible: old refresh tokens may not have a type claim
  if (payload.type && payload.type !== 'refresh') {
    throw new Error('Invalid token type')
  }
  return payload
}

async function authPlugin(fastify, opts) {
  fastify.decorate('signAccessToken', (payload) => {
    return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: JWT_ACCESS_TTL, algorithm: 'HS256' })
  })

  fastify.decorate('signRefreshToken', (payload) => {
    return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: JWT_REFRESH_TTL, algorithm: 'HS256' })
  })

  fastify.decorate('verifyToken', (token) => verifyAccessToken(token))
  fastify.decorate('verifyRefreshToken', (token) => verifyRefreshToken(token))

  fastify.addHook('onRequest', async function authHook(request, reply) {
    // Public routes (login, register, setup-required, health) skip auth.
    if (request.routeOptions?.config?.public) {
      return
    }

    const path = request.raw.url || request.url
    if (!path?.startsWith('/api/')) {
      return
    }

    let token = null
    const authHeader = request.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    } else if (request.cookies?.accessToken) {
      token = request.cookies.accessToken
    }

    if (!token) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    // Identity comes from the token; role and existence come from the database
    // on every request, so a demotion or a deleted account takes effect at once
    // instead of when the access token expires.
    // A database failure is NOT turned into a 401 (it surfaces as a 500 through
    // the error handler): a 401 would make the client drop a valid session.
    let user
    let viaApiToken = false
    if (looksLikeApiToken(token)) {
      // Personal API token: sha256 lookup, only the hash is stored
      const tokenHash = hashToken(token)
      const { rows } = await fastify.db.query(
        `SELECT u.id, u.login, u.role, u.language
         FROM api_tokens tok JOIN users u ON u.id = tok.user_id
         WHERE tok.token_hash = $1`,
        [tokenHash]
      )
      if (rows.length === 0) {
        return reply.code(401).send({ error: 'Invalid token' })
      }
      fastify.db.query('UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = $1', [tokenHash]).catch(() => {})
      user = rows[0]
      viaApiToken = true
    } else {
      let payload
      try {
        payload = fastify.verifyToken(token)
      } catch {
        return reply.code(401).send({ error: 'Invalid token' })
      }
      const { rows } = await fastify.db.query(
        'SELECT id, login, role, language FROM users WHERE id = $1',
        [payload.userId]
      )
      if (rows.length === 0) {
        return reply.code(401).send({ error: 'Invalid token' })
      }
      user = rows[0]
    }

    // Every user is a peer with their own data; sharing is resolved per
    // entity via the entity_shares table (services/visibility.js).
    request.user = {
      userId: user.id,
      login: user.login,
      role: user.role === 'admin' ? 'admin' : 'user',
      viaApiToken
    }

    if (viaApiToken && apiTokenForbidden(request.method, request.routeOptions?.url)) {
      const lang = user.language || process.env.DEFAULT_LANG || 'en'
      return reply.code(403).send({ error: t('errors.api_token_forbidden', {}, lang) })
    }

    const logData = { userId: request.user.userId, ip: request.ip, method: request.method, url: request.url }
    if (request.method === 'GET') {
      fastify.log.debug(logData, 'Authenticated request')
    } else {
      fastify.log.info(logData, 'Authenticated request')
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
