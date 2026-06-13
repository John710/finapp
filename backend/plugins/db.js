import fp from 'fastify-plugin'
import pg from 'pg'
const { Pool } = pg

async function dbPlugin(fastify, opts) {
  const enableSsl = process.env.DATABASE_SSL === 'true'
  const ssl = enableSsl
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl
  })

  fastify.decorate('db', pool)

  fastify.addHook('onClose', async (instance) => {
    await pool.end()
  })
}

export default fp(dbPlugin, { name: 'db' })
