import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m'
const JWT_REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d'

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is required and must be at least 32 characters')
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
    // Public routes (login, register, setup-required, health) skip JWT validation.
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

    try {
      request.user = fastify.verifyToken(token)
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid token' })
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
