import fp from 'fastify-plugin'
import pg from 'pg'
const { Pool } = pg

async function dbPlugin(fastify, opts) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  })

  fastify.decorate('db', pool)

  fastify.addHook('onClose', async (instance) => {
    await pool.end()
  })
}

export default fp(dbPlugin, { name: 'db' })
