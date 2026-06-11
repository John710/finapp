async function healthRoutes(fastify, opts) {
  fastify.get('/health', async (request, reply) => {
    try {
      const result = await fastify.db.query('SELECT 1')
      return {
        status: 'ok',
        version: '1.0.0',
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
