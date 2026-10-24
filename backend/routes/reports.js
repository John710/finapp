import { loadRates, convertAmount } from '../services/currency.js'

// Grouping by calendar month must not depend on the server timezone: node-pg
// parses DATE columns as local midnight, so toISOString() can shift the value
// into the previous month. Use local components for Date, plain slice for strings.
function monthKey(date) {
  if (typeof date === 'string') return date.slice(0, 7)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

const dateRangeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    account_id: { type: 'integer' },
    type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
    base_currency: { type: 'string', pattern: '^[A-Z]{3}$', default: 'USD' }
  }
}

async function reportRoutes(fastify, opts) {
  function getReportValue(tx, baseCurrency, rates) {
    const amount = parseFloat(tx.amount)
    if (!tx.account_currency || tx.account_currency === baseCurrency) return amount
    const converted = convertAmount(amount, tx.account_currency, baseCurrency, rates)
    if (converted !== null) return converted
    fastify.log.warn(`Report conversion failed for ${tx.account_currency} -> ${baseCurrency}, using raw amount ${tx.amount}`)
    return amount
  }

  async function fetchTransactionsWithAccounts(userId, whereClause, params) {
    const result = await fastify.db.query(`
      SELECT
        t.amount,
        t.type,
        t.date,
        t.category_id,
        a.currency as account_currency,
        a.type as account_type,
        c.name as category_name,
        c.color as category_color
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
      LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = $1
      WHERE t.user_id = $1 AND ${whereClause}
    `, [userId, ...params])
    return result.rows
  }

  fastify.get('/reports/summary', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const { from, to, account_id, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }
    if (account_id) { where.push(`t.account_id = $${idx++}`); params.push(account_id) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(userId, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    let totalIncome = 0
    let totalExpense = 0
    let totalTransfer = 0
    let net = 0
    let convertedCount = 0
    let unconvertedCount = 0

    for (const tx of txs) {
      const val = getReportValue(tx, base_currency, rates)
      if (tx.account_type === 'crypto') {
        const converted = convertAmount(parseFloat(tx.amount), tx.account_currency, base_currency, rates)
        if (converted !== null) convertedCount++
        else unconvertedCount++
      }

      if (tx.type === 'income') {
        totalIncome += val
        net += val
      } else if (tx.type === 'expense') {
        totalExpense += val
        net -= val
      } else if (tx.type === 'transfer') {
        totalTransfer += val
      }
    }

    return {
      total_income: totalIncome,
      total_expense: totalExpense,
      total_transfer: totalTransfer,
      net,
      count: txs.length,
      unconverted_count: unconvertedCount,
      base_currency
    }
  })

  fastify.get('/reports/by-category', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const { from, to, type, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (type) {
      where.push(`t.type = $${idx++}`)
      params.push(type)
    }
    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(userId, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    const categoryMap = new Map()
    let grandTotal = 0

    for (const tx of txs) {
      const val = getReportValue(tx, base_currency, rates)
      // Transfers are not spending/income — including them in grandTotal skews
      // every category percentage.
      if (tx.type !== 'transfer') grandTotal += val

      const key = tx.category_id || 'uncategorized'
      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          id: tx.category_id,
          name: tx.category_name,
          color: tx.category_color || '#94a3b8',
          total: 0,
          count: 0,
          type: tx.type
        })
      }
      const cat = categoryMap.get(key)
      cat.total += val
      cat.count++
    }

    const rows = Array.from(categoryMap.values())
      .map(r => ({
        ...r,
        total: parseFloat(r.total.toFixed(2)),
        percentage: grandTotal > 0 ? parseFloat(((r.total / grandTotal) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.total - a.total)

    return rows
  })

  fastify.get('/reports/trend', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const { from, to, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(userId, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    const monthMap = new Map()

    for (const tx of txs) {
      const month = monthKey(tx.date)
      const val = getReportValue(tx, base_currency, rates)

      if (!monthMap.has(month)) {
        monthMap.set(month, { month, income: 0, expense: 0, transfer: 0 })
      }
      const m = monthMap.get(month)
      if (tx.type === 'income') m.income += val
      else if (tx.type === 'expense') m.expense += val
      else if (tx.type === 'transfer') m.transfer += val
    }

    const rows = Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(r => ({
        month: r.month,
        income: parseFloat(r.income.toFixed(2)),
        expense: parseFloat(r.expense.toFixed(2)),
        transfer: parseFloat(r.transfer.toFixed(2)),
        net: parseFloat((r.income - r.expense).toFixed(2))
      }))

    return rows
  })

  fastify.get('/reports/net-worth', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          months: { type: 'integer', minimum: 1, maximum: 120, default: 12 },
          base_currency: { type: 'string', pattern: '^[A-Z]{3}$', default: 'USD' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { months: monthsInt = 12, base_currency = 'USD' } = request.query

    const rates = await loadRates(fastify.db)

    // Anchor the series to the CURRENT account balances: they already include
    // initial balances and manual adjustments that have no transaction rows.
    // Monthly values are reconstructed backwards from the signed transaction
    // flow, so months before the first transaction still show real balances.
    const accountsRes = await fastify.db.query(
      'SELECT balance, currency FROM accounts WHERE user_id = $1',
      [userId]
    )
    let currentTotal = 0
    for (const acc of accountsRes.rows) {
      const amount = parseFloat(acc.balance)
      if (!acc.currency || acc.currency === base_currency) {
        currentTotal += amount
        continue
      }
      const converted = convertAmount(amount, acc.currency, base_currency, rates)
      if (converted !== null) currentTotal += converted
      else {
        fastify.log.warn(`Net-worth conversion failed for ${acc.currency} -> ${base_currency}, using raw amount`)
        currentTotal += amount
      }
    }

    const allTxs = await fastify.db.query(`
      SELECT t.amount, t.type, t.date, a.currency as account_currency
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
      ORDER BY t.date ASC
    `, [userId])

    // Signed monthly flow: income adds (the paired leg of a transfer is an
    // income row, so incoming transfers count too), expense/transfer-out subtract.
    const flowByMonth = new Map()
    for (const tx of allTxs.rows) {
      const val = getReportValue(tx, base_currency, rates)
      const sign = tx.type === 'income' ? 1 : -1
      const month = monthKey(tx.date)
      flowByMonth.set(month, (flowByMonth.get(month) || 0) + val * sign)
    }

    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - monthsInt + 1, 1)
    const monthsList = []
    for (let d = new Date(start); d <= now; d.setMonth(d.getMonth() + 1)) {
      monthsList.push(monthKey(d))
    }

    // Flows after the window still differ from the anchor; subtract them first.
    const lastMonth = monthsList[monthsList.length - 1]
    let suffixFlow = 0
    for (const [m, f] of flowByMonth) {
      if (m > lastMonth) suffixFlow += f
    }

    // Walk backwards: balance(end of month i-1) = balance(end of month i) - flow(i)
    const balances = new Array(monthsList.length)
    let bal = currentTotal - suffixFlow
    for (let i = monthsList.length - 1; i >= 0; i--) {
      balances[i] = bal
      bal -= flowByMonth.get(monthsList[i]) || 0
    }

    return monthsList.map((month, i) => ({
      month,
      change: parseFloat((flowByMonth.get(month) || 0).toFixed(2)),
      balance: parseFloat(balances[i].toFixed(2))
    }))
  })

  fastify.get('/reports/savings-rate', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const { from, to, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(userId, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    let income = 0
    let expense = 0

    for (const tx of txs) {
      const val = getReportValue(tx, base_currency, rates)
      if (tx.type === 'income') income += val
      else if (tx.type === 'expense') expense += val
    }

    const savings = income - expense
    const rate = income > 0 ? (savings / income) * 100 : 0
    return {
      income: parseFloat(income.toFixed(2)),
      expense: parseFloat(expense.toFixed(2)),
      savings: parseFloat(savings.toFixed(2)),
      rate: parseFloat(rate.toFixed(2)),
      base_currency
    }
  })
}

export default reportRoutes
