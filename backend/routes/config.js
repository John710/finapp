export default async function configRoutes(fastify, opts) {
  fastify.get('/config/public', {
    config: { public: true }
  }, async (request, reply) => {
    return {
      defaultLanguage: process.env.DEFAULT_LANG || 'en'
    }
  })
}
