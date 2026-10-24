import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m'
const JWT_REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d'

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is required and must be at least 32 characters')
}

// Personal API tokens are 64 hex chars; JWTs contain dots
function looksLikeApiToken(token) {
  return /^[0-9a-f]{64}$/.test(token)
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function authPlugin(fastify, opts) {
  fastify.decorate('signAccessToken', (payload) => {
    return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: JWT_ACCESS_TTL })
  })

  fastify.decorate('signRefreshToken', (payload) => {
    return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: JWT_REFRESH_TTL })
  })

  fastify.decorate('verifyToken', (token) => {
    return jwt.verify(token, JWT_SECRET)
  })

  fastify.decorate('verifyRefreshToken', (token) => {
    const payload = jwt.verify(token, JWT_SECRET)
    // Backward compatible: old tokens may not have a type claim
    if (payload.type && payload.type !== 'refresh') {
      throw new Error('Invalid token type')
    }
    return payload
  })

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

    let payload
    try {
      if (looksLikeApiToken(token)) {
        // Personal API token: sha256 lookup, only the hash is stored
        const { rows } = await fastify.db.query(
          `SELECT u.id, u.login, u.role
           FROM api_tokens tok JOIN users u ON u.id = tok.user_id
           WHERE tok.token_hash = $1`,
          [hashToken(token)]
        )
        if (rows.length === 0) {
          return reply.code(401).send({ error: 'Invalid token' })
        }
        fastify.db.query('UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = $1', [hashToken(token)]).catch(() => {})
        payload = { userId: rows[0].id, login: rows[0].login, role: rows[0].role || 'user' }
      } else {
        payload = fastify.verifyToken(token)
      }
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid token' })
    }

    // Every user is a peer with their own data; sharing is resolved per
    // entity via the entity_shares table (services/visibility.js).
    request.user = {
      userId: payload.userId,
      login: payload.login,
      role: payload.role === 'admin' ? 'admin' : 'user'
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
