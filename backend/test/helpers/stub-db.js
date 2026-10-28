import Fastify from 'fastify'

// Routes are exercised end-to-end against a live database by
// scripts/blackbox-test.mjs. Unit tests here run them on a recording stub db so
// the HTTP contract stays testable without PostgreSQL: status codes, validation,
// the shape of the dates that reach the client, and the SQL a handler refuses to
// build.
//
// Each handler is `{ match: RegExp, rows: array | () => array, throws?: () => Error }`.
// The first matching handler answers the query; `throws` simulates a driver error
// (PostgreSQL code/constraint) for that statement.

export const TEST_USER = 7

export function buildStubServer(routePlugin, handlers = [], { userId = TEST_USER, prefix = '/' } = {}) {
  const queries = []
  const answer = sql => {
    for (const h of handlers) {
      if (h.match.test(sql)) {
        if (h.throws) throw h.throws()
        return typeof h.rows === 'function' ? h.rows() : h.rows
      }
    }
    return []
  }
  const run = sql => params => {
    queries.push({ sql: sql.trim(), params })
    const rows = answer(sql)
    return { rows, rowCount: rows.length }
  }
  const db = {
    query: async (sql, params = []) => run(sql)(params),
    connect: async () => ({
      query: async (sql, params = []) => run(sql)(params),
      release: () => {}
    })
  }
  const app = Fastify()
  app.decorate('db', db)
  app.addHook('preHandler', async request => {
    request.user = { userId }
  })
  app.register(routePlugin, { prefix })
  return { app, queries, db }
}

export function pgError(code, constraint) {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`)
  err.code = code
  err.constraint = constraint
  return err
}
