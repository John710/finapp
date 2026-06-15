import pkg from '../package.json' with { type: 'json' }

async function healthRoutes(fastify, opts) {
  fastify.get('/health', { config: { public: true } }, async (request, reply) => {
    try {
      const result = await fastify.db.query('SELECT 1')
      return {
        status: 'ok',
        version: pkg.version,
        db: 'connected',
        uptime: Math.floor(process.uptime())
      }
    } catch (err) {
      reply.code(503)
      return {
        status: 'error',
        db: 'disconnected'
      }
    }
  })
}

export default healthRoutes
