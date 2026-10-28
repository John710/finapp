import fp from 'fastify-plugin'
import pg from 'pg'
const { Pool } = pg

// DATE columns are calendar days, not instants. pg's default parser turns them
// into a Date at local midnight of the Node process (TZ=Asia/Vladivostok in
// production), which JSON then serialises in UTC — 2026-10-29 reached clients
// as "2026-10-28T14:00:00.000Z". Keep them as the 'YYYY-MM-DD' text PostgreSQL
// sends. TIMESTAMP columns are untouched.
pg.types.setTypeParser(pg.types.builtins.DATE, value => value)

export const POOL_OPTIONS = {
  max: 20,
  connectionTimeoutMillis: 10000,
  // Client-side cap on waiting for a result...
  query_timeout: 30000,
  // ...and a server-side one, so PostgreSQL itself cancels a runaway statement
  // instead of leaving it running after the client gave up.
  statement_timeout: 30000,
  idleTimeoutMillis: 30000
}

async function dbPlugin(fastify, opts) {
  const enableSsl = process.env.DATABASE_SSL === 'true'
  const ssl = enableSsl
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    ...POOL_OPTIONS
  })

  // An idle client that loses its connection (database restart, network drop)
  // emits 'error' on the pool; without a listener that is an uncaught error
  // and takes the whole process down. The pool discards the client itself.
  pool.on('error', err => {
    fastify.log.error({ err }, 'PostgreSQL idle client error')
  })

  fastify.decorate('db', pool)

  fastify.addHook('onClose', async (instance) => {
    await pool.end()
  })
}

export default fp(dbPlugin, { name: 'db' })
