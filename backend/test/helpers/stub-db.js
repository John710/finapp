import Fastify from 'fastify'
import { afterEach } from 'vitest'

// Routes are exercised end-to-end against a live database by
// scripts/blackbox-test.mjs. Unit tests here run them on a recording stub db so
// the HTTP contract stays testable without PostgreSQL: status codes, validation,
// the shape of the dates that reach the client, and the SQL a handler refuses to
// build.
//
// Each handler is `{ match: RegExp, rows: array | (params, sql) => array, throws?: () => Error }`.
// The first matching handler answers the query; `throws` simulates a driver error
// (PostgreSQL code/constraint) for that statement.
//
// Every statement is checked like PostgreSQL's extended protocol does: the bind
// array must hold exactly as many values as the highest `$n` placeholder. A
// mismatch throws the driver error (08P01) inside the route — so the handler sees
// what production would — and fails the running test even when the route
// swallows the error.

export const TEST_USER = 7

const bindViolations = []

afterEach(() => {
  if (bindViolations.length === 0) return
  const found = bindViolations.splice(0)
  throw new Error(`Bind parameter count mismatch:\n${found.join('\n')}`)
})

// Drains the recorded mismatches — only for tests of this guard itself.
export function takeBindViolations() {
  return bindViolations.splice(0)
}

export function highestPlaceholder(sql) {
  let max = 0
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]))
  return max
}

function bindError(sql, params) {
  const expected = highestPlaceholder(sql)
  if (params.length === expected) return null
  const message = `bind message supplies ${params.length} parameters, but prepared statement requires ${expected}`
  bindViolations.push(`${message}: ${sql}`)
  const err = new Error(message)
  err.code = '08P01'
  return err
}

export function buildStubDb(handlers = []) {
  const queries = []
  const answer = (sql, params) => {
    for (const h of handlers) {
      if (h.match.test(sql)) {
        if (h.throws) throw h.throws()
        return typeof h.rows === 'function' ? h.rows(params, sql) : h.rows
      }
    }
    return []
  }
  const run = sql => params => {
    const normalized = sql.trim().replace(/\s+/g, ' ')
    queries.push({ sql: normalized, params })
    const err = bindError(normalized, params)
    if (err) throw err
    const rows = answer(sql, params)
    return { rows, rowCount: rows.length }
  }
  const db = {
    query: async (sql, params = []) => run(sql)(params),
    connect: async () => ({
      query: async (sql, params = []) => run(sql)(params),
      release: () => {}
    })
  }
  return { db, queries }
}

export function buildStubServer(routePlugin, handlers = [], { userId = TEST_USER, role = 'user', prefix = '/' } = {}) {
  const { db, queries } = buildStubDb(handlers)
  const app = Fastify()
  app.decorate('db', db)
  app.addHook('preHandler', async request => {
    request.user = { userId, role }
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
