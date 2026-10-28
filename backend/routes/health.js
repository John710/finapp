async function healthRoutes(fastify, opts) {
  // Public liveness probe for the Docker/compose healthchecks. It reports only
  // whether the database answers: the version and uptime were readable by
  // anyone (fingerprinting, restart timing) and no client used them.
  fastify.get('/health', { config: { public: true } }, async (request, reply) => {
    try {
      await fastify.db.query('SELECT 1')
      return {
        status: 'ok',
        db: 'connected'
      }
    } catch {
      reply.code(503)
      return {
        status: 'error',
        db: 'disconnected'
      }
    }
  })
}

export default healthRoutes
