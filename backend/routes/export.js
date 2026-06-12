async function exportRoutes(fastify, opts) {
  fastify.get('/export/csv', async (request, reply) => {
    const { from, to, account_id, category_id } = request.query
    let where = ['1=1']
    let params = []
    let idx = 1

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
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${whereClause}
      ORDER BY t.date DESC
    `, params)

    const rows = result.rows
    const headers = ['Date', 'Account', 'Type', 'Category', 'Amount', 'Currency', 'Note']
    const lines = [
      '\uFEFF' + headers.join(';'),
      ...rows.map(r => [
        r.date,
        r.account_name || '',
        r.type,
        r.category_name || '',
        r.amount,
        r.currency,
        (r.note || '').replace(/;/g, ',')
      ].join(';'))
    ]

    const filename = `finapp_export_${new Date().toISOString().split('T')[0]}.csv`

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return lines.join('\n')
  })
}

export default exportRoutes
