import { loadRates, convertAmount } from '../services/currency.js'

async function reportRoutes(fastify, opts) {
  // Helper: get report value — convert any transaction amount into the requested base currency
  function getReportValue(tx, baseCurrency, rates) {
    const amount = parseFloat(tx.amount)
    if (!tx.account_currency || tx.account_currency === baseCurrency) return amount
    const converted = convertAmount(amount, tx.account_currency, baseCurrency, rates)
    if (converted !== null) return converted
    fastify.log.warn(`Report conversion failed for ${tx.account_currency} -> ${baseCurrency}, using raw amount ${tx.amount}`)
    return amount
  }

  // Helper: fetch transactions with account currency for a period
  async function fetchTransactionsWithAccounts(whereClause, params) {
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
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${whereClause}
    `, params)
    return result.rows
  }

  // Summary report
  fastify.get('/reports/summary', async (request, reply) => {
    const { from, to, account_id, base_currency = 'USD' } = request.query
    let where = ['1=1']
    let params = []
    let idx = 1

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }
    if (account_id) { where.push(`t.account_id = $${idx++}`); params.push(account_id) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(where.join(' AND '), params),
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

  // By category report
  fastify.get('/reports/by-category', async (request, reply) => {
    const { from, to, type = 'expense', base_currency = 'USD' } = request.query
    let where = ['t.type = $1']
    let params = [type]
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(where.join(' AND '), params),
      loadRates(fastify.db)
    ])

    const categoryMap = new Map()
    let grandTotal = 0

    for (const tx of txs) {
      const val = getReportValue(tx, base_currency, rates)
      grandTotal += val

      const key = tx.category_id || 'uncategorized'
      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          id: tx.category_id,
          name: tx.category_name,
          color: tx.category_color || '#94a3b8',
          total: 0,
          count: 0
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

  // Monthly trend
  fastify.get('/reports/trend', async (request, reply) => {
    const { from, to, base_currency = 'USD' } = request.query
    let where = ['1=1']
    let params = []
    let idx = 1

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(where.join(' AND '), params),
      loadRates(fastify.db)
    ])

    const monthMap = new Map()

    for (const tx of txs) {
      const month = typeof tx.date === 'string' ? tx.date.slice(0, 7) : tx.date.toISOString().slice(0, 7)
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

  // Net worth over time (running balance per month)
  fastify.get('/reports/net-worth', async (request, reply) => {
    const { months = 12, base_currency = 'USD' } = request.query
    const monthsInt = parseInt(months, 10) || 12

    const rates = await loadRates(fastify.db)

    // Get all historical transactions ordered by date
    const allTxs = await fastify.db.query(`
      SELECT t.amount, t.type, t.date, a.currency as account_currency, a.type as account_type
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      ORDER BY t.date ASC
    `)

    // Build cumulative balance per month
    const monthlyData = new Map()
    let runningBalance = 0

    // Generate month range
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsInt + 1, 1)

    for (const tx of allTxs.rows) {
      const val = getReportValue(tx, base_currency, rates)
      const sign = tx.type === 'income' ? 1 : -1
      runningBalance += val * sign

      const month = typeof tx.date === 'string' ? tx.date.slice(0, 7) : tx.date.toISOString().slice(0, 7)
      if (!monthlyData.has(month)) {
        monthlyData.set(month, { change: 0, balance: runningBalance })
      }
      const m = monthlyData.get(month)
      m.change += val * sign
      m.balance = runningBalance
    }

    // Fill missing months
    const output = []
    let lastBalance = 0
    for (let d = new Date(startDate); d <= now; d.setMonth(d.getMonth() + 1)) {
      const month = d.toISOString().slice(0, 7)
      const data = monthlyData.get(month)
      if (data) {
        lastBalance = data.balance
        output.push({
          month,
          change: parseFloat(data.change.toFixed(2)),
          balance: parseFloat(data.balance.toFixed(2))
        })
      } else {
        output.push({ month, change: 0, balance: parseFloat(lastBalance.toFixed(2)) })
      }
    }

    return output
  })

  // Savings rate
  fastify.get('/reports/savings-rate', async (request, reply) => {
    const { from, to, base_currency = 'USD' } = request.query
    let where = ['1=1']
    let params = []
    let idx = 1

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [txs, rates] = await Promise.all([
      fetchTransactionsWithAccounts(where.join(' AND '), params),
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
