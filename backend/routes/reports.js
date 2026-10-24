import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal } from '../services/currency.js'
import { visibleAccountIds } from '../services/visibility.js'

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
  // Convert a grouped SQL sum into the base currency as an exact Decimal.
  // When no rate exists the raw amount is used (and logged) so the report
  // degrades gracefully instead of hiding the money.
  function sumInBase(amount, accountCurrency, baseCurrency, rates) {
    if (!accountCurrency || accountCurrency === baseCurrency) return new Decimal(amount)
    const converted = convertAmountDecimal(amount, accountCurrency, baseCurrency, rates)
    if (converted !== null) return converted
    fastify.log.warn(`Report conversion failed for ${accountCurrency} -> ${baseCurrency}, using raw amount ${amount}`)
    return new Decimal(amount)
  }

  // Aggregations happen in SQL (SUM/GROUP BY over at most one row per
  // currency×dimension) — previously every report pulled all matching
  // transaction rows into memory and summed them in JS.
  // Flow totals (summary/trend/net-worth) count parent+regular rows and skip
  // split children, which are bookkeeping rows with no balance effect.
  async function fetchTotalsByTypeCurrency(userId, visible, whereClause, params) {
    const result = await fastify.db.query(`
      SELECT t.type, a.currency as account_currency, a.type as account_type,
             COALESCE(SUM(t.amount), 0) as sum, COUNT(*)::int as count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = ANY($2) AND t.parent_id IS NULL AND ${whereClause}
      GROUP BY t.type, a.currency, a.type
    `, [userId, visible, ...params])
    return result.rows
  }

  async function fetchTotalsByCategory(userId, visible, whereClause, params) {
    // Category totals count split children (they carry the categories) and
    // skip split parents, whose category is NULL.
    const result = await fastify.db.query(`
      SELECT t.category_id, c.name as category_name, c.color as category_color,
             t.type, a.currency as account_currency,
             COALESCE(SUM(t.amount), 0) as sum, COUNT(*)::int as count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.account_id = ANY($2) AND NOT t.is_split AND ${whereClause}
      GROUP BY t.category_id, c.name, c.color, t.type, a.currency
    `, [userId, visible, ...params])
    return result.rows
  }

  async function fetchTotalsByMonth(userId, visible, whereClause, params) {
    const result = await fastify.db.query(`
      SELECT to_char(t.date, 'YYYY-MM') as month, t.type, a.currency as account_currency,
             COALESCE(SUM(t.amount), 0) as sum
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = ANY($2) AND t.parent_id IS NULL AND ${whereClause}
      GROUP BY 1, t.type, a.currency
    `, [userId, visible, ...params])
    return result.rows
  }

  fastify.get('/reports/summary', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const visible = await visibleAccountIds(fastify.db, userId)
    const { from, to, account_id, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }
    if (account_id) { where.push(`t.account_id = $${idx++}`); params.push(account_id) }

    const [groups, rates] = await Promise.all([
      fetchTotalsByTypeCurrency(userId, visible, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    let totalIncome = new Decimal(0)
    let totalExpense = new Decimal(0)
    let totalTransfer = new Decimal(0)
    let count = 0
    let unconvertedCount = 0

    for (const g of groups) {
      count += g.count
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      if (g.account_type === 'crypto' && g.account_currency && g.account_currency !== base_currency) {
        const converted = convertAmountDecimal(g.sum, g.account_currency, base_currency, rates)
        if (converted === null) unconvertedCount += g.count
      }
      if (g.type === 'income') totalIncome = totalIncome.plus(val)
      else if (g.type === 'expense') totalExpense = totalExpense.plus(val)
      else if (g.type === 'transfer') totalTransfer = totalTransfer.plus(val)
    }

    return {
      total_income: totalIncome.toNumber(),
      total_expense: totalExpense.toNumber(),
      total_transfer: totalTransfer.toNumber(),
      net: totalIncome.minus(totalExpense).toNumber(),
      count,
      unconverted_count: unconvertedCount,
      base_currency
    }
  })

  fastify.get('/reports/by-category', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const visible = await visibleAccountIds(fastify.db, userId)
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

    const [groups, rates] = await Promise.all([
      fetchTotalsByCategory(userId, visible, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    const categoryMap = new Map()
    let grandTotal = new Decimal(0)

    for (const g of groups) {
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      // Transfers are not spending/income — including them in grandTotal skews
      // every category percentage.
      if (g.type !== 'transfer') grandTotal = grandTotal.plus(val)

      const key = g.category_id || 'uncategorized'
      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          id: g.category_id,
          name: g.category_name,
          color: g.category_color || '#94a3b8',
          total: new Decimal(0),
          count: 0,
          type: g.type
        })
      }
      const cat = categoryMap.get(key)
      cat.total = cat.total.plus(val)
      cat.count += g.count
    }

    const grand = grandTotal.toNumber()
    const rows = Array.from(categoryMap.values())
      .map(r => {
        const total = r.total.toNumber()
        return {
          ...r,
          total: parseFloat(total.toFixed(2)),
          percentage: grand > 0 ? parseFloat(((total / grand) * 100).toFixed(1)) : 0
        }
      })
      .sort((a, b) => b.total - a.total)

    return rows
  })

  fastify.get('/reports/trend', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const visible = await visibleAccountIds(fastify.db, userId)
    const { from, to, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [groups, rates] = await Promise.all([
      fetchTotalsByMonth(userId, visible, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    const monthMap = new Map()

    for (const g of groups) {
      if (!monthMap.has(g.month)) {
        monthMap.set(g.month, { month: g.month, income: new Decimal(0), expense: new Decimal(0), transfer: new Decimal(0) })
      }
      const m = monthMap.get(g.month)
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      if (g.type === 'income') m.income = m.income.plus(val)
      else if (g.type === 'expense') m.expense = m.expense.plus(val)
      else if (g.type === 'transfer') m.transfer = m.transfer.plus(val)
    }

    return Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(r => {
        const income = r.income.toNumber()
        const expense = r.expense.toNumber()
        return {
          month: r.month,
          income: parseFloat(income.toFixed(2)),
          expense: parseFloat(expense.toFixed(2)),
          transfer: parseFloat(r.transfer.toNumber().toFixed(2)),
          net: parseFloat((income - expense).toFixed(2))
        }
      })
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
    const visible = await visibleAccountIds(fastify.db, userId)
    const { months: monthsInt = 12, base_currency = 'USD' } = request.query

    const rates = await loadRates(fastify.db)

    // Anchor the series to the CURRENT account balances: they already include
    // initial balances and manual adjustments that have no transaction rows.
    // Monthly values are reconstructed backwards from the signed transaction
    // flow, so months before the first transaction still show real balances.
    const accountsRes = await fastify.db.query(
      'SELECT balance, currency FROM accounts WHERE id = ANY($2)',
      [userId, visible]
    )
    let currentTotal = new Decimal(0)
    for (const acc of accountsRes.rows) {
      currentTotal = currentTotal.plus(sumInBase(acc.balance, acc.currency, base_currency, rates))
    }

    // Signed monthly flow aggregated in SQL: income adds (the paired leg of a
    // transfer is an income row, so incoming transfers count too),
    // expense/transfer-out subtract.
    const flowGroups = await fetchTotalsByMonth(userId, visible, '1=1', [])
    const flowByMonth = new Map()
    for (const g of flowGroups) {
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      const sign = g.type === 'income' ? 1 : -1
      const month = g.month
      flowByMonth.set(month, (flowByMonth.get(month) || new Decimal(0)).plus(val.times(sign)))
    }

    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - monthsInt + 1, 1)
    const monthsList = []
    for (let d = new Date(start); d <= now; d.setMonth(d.getMonth() + 1)) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      monthsList.push(`${y}-${m}`)
    }

    // Flows after the window still differ from the anchor; subtract them first.
    const lastMonth = monthsList[monthsList.length - 1]
    let suffixFlow = new Decimal(0)
    for (const [m, f] of flowByMonth) {
      if (m > lastMonth) suffixFlow = suffixFlow.plus(f)
    }

    // Walk backwards: balance(end of month i-1) = balance(end of month i) - flow(i)
    const balances = new Array(monthsList.length)
    let bal = currentTotal.minus(suffixFlow)
    for (let i = monthsList.length - 1; i >= 0; i--) {
      balances[i] = bal
      bal = bal.minus(flowByMonth.get(monthsList[i]) || new Decimal(0))
    }

    return monthsList.map((month, i) => ({
      month,
      change: parseFloat((flowByMonth.get(month) || new Decimal(0)).toNumber().toFixed(2)),
      balance: parseFloat(balances[i].toNumber().toFixed(2))
    }))
  })

  fastify.get('/reports/savings-rate', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const visible = await visibleAccountIds(fastify.db, userId)
    const { from, to, base_currency = 'USD' } = request.query
    let where = []
    let params = []
    let idx = 2

    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }

    const [groups, rates] = await Promise.all([
      fetchTotalsByTypeCurrency(userId, visible, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    let income = new Decimal(0)
    let expense = new Decimal(0)

    for (const g of groups) {
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      if (g.type === 'income') income = income.plus(val)
      else if (g.type === 'expense') expense = expense.plus(val)
    }

    const savings = income.minus(expense)
    const rate = income.gt(0) ? savings.div(income).times(100) : new Decimal(0)
    return {
      income: parseFloat(income.toNumber().toFixed(2)),
      expense: parseFloat(expense.toNumber().toFixed(2)),
      savings: parseFloat(savings.toNumber().toFixed(2)),
      rate: parseFloat(rate.toNumber().toFixed(2)),
      base_currency
    }
  })
}

export default reportRoutes
