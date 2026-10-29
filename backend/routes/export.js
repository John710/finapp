import Papa from 'papaparse'

// Guard against CSV formula injection: a note/category that begins with
// =, +, -, @ (or a tab/CR) would be executed as a formula when the export is
// opened in Excel/LibreOffice. Prefix such values with a single quote.
function csvSafe(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

async function exportRoutes(fastify, opts) {
  fastify.get('/export/csv', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', format: 'date' },
          to: { type: 'string', format: 'date' },
          account_id: { type: 'integer' },
          category_id: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { from, to, account_id, category_id } = request.query
    let where = ['t.user_id = $1']
    let params = [userId]
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }
    if (account_id) { where.push(`t.account_id = $${idx++}`); params.push(account_id) }
    if (category_id) { where.push(`t.category_id = $${idx++}`); params.push(category_id) }

    const whereClause = where.join(' AND ')

    const [result, todayRes] = await Promise.all([
      fastify.db.query(`
        SELECT
          t.date::text AS date,
          a.name as account_name,
          t.type,
          c.name as category_name,
          t.amount,
          a.currency,
          t.note
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE ${whereClause}
        ORDER BY t.date DESC
      `, params),
      // The file is named after the database day, the same calendar the
      // exported dates use — not the UTC day of the Node clock.
      fastify.db.query('SELECT CURRENT_DATE::text AS today')
    ])

    const rows = result.rows.map(r => ({
      Date: r.date,
      Account: csvSafe(r.account_name),
      Type: r.type,
      Category: csvSafe(r.category_name),
      Amount: r.amount,
      Currency: r.currency,
      Note: csvSafe(r.note)
    }))

    const csv = Papa.unparse(rows, {
      delimiter: ';',
      header: true
    })

    const filename = `finapp_export_${todayRes.rows[0].today}.csv`

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return '\uFEFF' + csv
  })
}

export default exportRoutes
