import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m'
const JWT_REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d'

async function authPlugin(fastify, opts) {
  fastify.decorate('signAccessToken', (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_TTL })
  })

  fastify.decorate('signRefreshToken', (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_TTL })
  })

  fastify.decorate('verifyToken', (token) => {
    return jwt.verify(token, JWT_SECRET)
  })

  fastify.addHook('onRequest', async (request, reply) => {
    const path = request.raw.url || request.url
    if (!path?.startsWith('/api/') || path?.startsWith('/api/v1/auth') || path === '/api/v1/vapid-public-key') {
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
      reply.code(401).send({ error: 'Unauthorized' })
      return
    }

    try {
      request.user = fastify.verifyToken(token)
    } catch (err) {
      reply.code(401).send({ error: 'Invalid token' })
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
