import Papa from 'papaparse'

async function exportRoutes(fastify, opts) {
  fastify.get('/export/csv', async (request, reply) => {
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

    const result = await fastify.db.query(`
      SELECT
        t.date,
        a.name as account_name,
        t.type,
        c.name as category_name,
        t.amount,
        a.currency,
        t.note
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
      LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = $1
      WHERE ${whereClause}
      ORDER BY t.date DESC
    `, params)

    const rows = result.rows.map(r => ({
      Date: r.date,
      Account: r.account_name || '',
      Type: r.type,
      Category: r.category_name || '',
      Amount: r.amount,
      Currency: r.currency,
      Note: r.note || ''
    }))

    const csv = Papa.unparse(rows, {
      delimiter: ';',
      header: true
    })

    const filename = `finapp_export_${new Date().toISOString().split('T')[0]}.csv`

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return '\uFEFF' + csv
  })
}

export default exportRoutes
