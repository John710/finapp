import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal, toDisplayNumber } from '../services/currency.js'
import { visibleAccountIds } from '../services/visibility.js'
import { FLOW_TYPE_SQL, flowSign } from '../services/flows.js'
import { t, getUserLang } from '../services/i18n.js'
import { loadOccurrenceFlags, loadVisibleRules } from '../services/recurring-rules.js'
import { projectOccurrences, resolveProjectionWindow, shiftMonth } from '../services/recurring-schedule.js'

// Every calendar month the range touches, so a chart axis stays continuous even
// for months without any scheduled money.
function calendarMonths(from, to) {
  const keys = []
  let key = from.slice(0, 7)
  const last = to.slice(0, 7)
  while (key <= last) {
    keys.push(key)
    key = shiftMonth(key, 1)
  }
  return keys
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
  // The paired income leg of a transfer comes back as type 'transfer_in'
  // (FLOW_TYPE_SQL): it is not income, but balance walks still need it.
  async function fetchTotalsByTypeCurrency(visible, whereClause, params) {
    const result = await fastify.db.query(`
      SELECT ${FLOW_TYPE_SQL} as type, a.currency as account_currency, a.type as account_type,
             COALESCE(SUM(t.amount), 0) as sum, COUNT(*)::int as count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = ANY($1) AND t.parent_id IS NULL AND ${whereClause}
      GROUP BY 1, 2, 3
    `, [visible, ...params])
    return result.rows
  }

  async function fetchTotalsByCategory(visible, whereClause, params) {
    // Category totals count split children (they carry the categories) and
    // skip split parents, whose category is NULL.
    const result = await fastify.db.query(`
      SELECT t.category_id, c.name as category_name, c.color as category_color,
             ${FLOW_TYPE_SQL} as type, a.currency as account_currency,
             COALESCE(SUM(t.amount), 0) as sum, COUNT(*)::int as count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.account_id = ANY($1) AND NOT t.is_split AND ${whereClause}
      GROUP BY 1, 2, 3, 4, 5
    `, [visible, ...params])
    return result.rows
  }

  async function fetchTotalsByMonth(visible, whereClause, params) {
    const result = await fastify.db.query(`
      SELECT to_char(t.date, 'YYYY-MM') as month, ${FLOW_TYPE_SQL} as type, a.currency as account_currency,
             COALESCE(SUM(t.amount), 0) as sum
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = ANY($1) AND t.parent_id IS NULL AND ${whereClause}
      GROUP BY 1, 2, 3
    `, [visible, ...params])
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
      fetchTotalsByTypeCurrency(visible, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    let totalIncome = new Decimal(0)
    let totalExpense = new Decimal(0)
    let totalTransfer = new Decimal(0)
    let count = 0
    let unconvertedCount = 0

    for (const g of groups) {
      // The incoming leg is the other half of a transfer already counted
      // once as its outgoing row.
      if (g.type === 'transfer_in') continue
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
      fetchTotalsByCategory(visible, where.length ? where.join(' AND ') : '1=1', params),
      loadRates(fastify.db)
    ])

    // Income and expense of the same category are different money: rows are
    // keyed by type + category, and each percentage is a share of its own
    // type's total. Transfer legs are not income and drop out entirely.
    const categoryMap = new Map()
    const totalsByType = new Map()

    for (const g of groups) {
      if (g.type === 'transfer_in') continue
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      totalsByType.set(g.type, (totalsByType.get(g.type) || new Decimal(0)).plus(val))

      const key = `${g.type}:${g.category_id ?? 'uncategorized'}`
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

    // Ordered on the exact totals, rounded only for the response
    const rows = Array.from(categoryMap.values())
      .sort((a, b) => b.total.comparedTo(a.total))
      .map(r => {
        const typeTotal = totalsByType.get(r.type)
        return {
          ...r,
          total: toDisplayNumber(r.total, base_currency),
          percentage: typeTotal && typeTotal.gt(0) ? r.total.div(typeTotal).times(100).toDecimalPlaces(1).toNumber() : 0
        }
      })

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
      fetchTotalsByMonth(visible, where.length ? where.join(' AND ') : '1=1', params),
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
      .map(r => ({
        month: r.month,
        income: toDisplayNumber(r.income, base_currency),
        expense: toDisplayNumber(r.expense, base_currency),
        transfer: toDisplayNumber(r.transfer, base_currency),
        net: toDisplayNumber(r.income.minus(r.expense), base_currency)
      }))
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
      'SELECT balance, currency FROM accounts WHERE id = ANY($1)',
      [visible]
    )
    let currentTotal = new Decimal(0)
    for (const acc of accountsRes.rows) {
      currentTotal = currentTotal.plus(sumInBase(acc.balance, acc.currency, base_currency, rates))
    }

    // Signed monthly flow aggregated in SQL: income and the incoming leg of a
    // transfer add, expense/transfer-out subtract.
    const flowGroups = await fetchTotalsByMonth(visible, '1=1', [])
    const flowByMonth = new Map()
    for (const g of flowGroups) {
      const val = sumInBase(g.sum, g.account_currency, base_currency, rates)
      const sign = flowSign(g.type)
      const month = g.month
      flowByMonth.set(month, (flowByMonth.get(month) || new Decimal(0)).plus(val.times(sign)))
    }

    // The series ends at the database's current month, not the Node clock's:
    // the container runs a different timezone than PostgreSQL, and the
    // dashboard's net-worth series already follows CURRENT_DATE.
    const { rows: [{ today }] } = await fastify.db.query('SELECT CURRENT_DATE::text AS today')
    const currentMonth = today.slice(0, 7)
    const monthsList = []
    for (let i = monthsInt - 1; i >= 0; i--) monthsList.push(shiftMonth(currentMonth, -i))

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
      change: toDisplayNumber(flowByMonth.get(month) || 0, base_currency),
      balance: toDisplayNumber(balances[i], base_currency)
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
      fetchTotalsByTypeCurrency(visible, where.length ? where.join(' AND ') : '1=1', params),
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
      income: toDisplayNumber(income, base_currency),
      expense: toDisplayNumber(expense, base_currency),
      savings: toDisplayNumber(savings, base_currency),
      rate: rate.toDecimalPlaces(2).toNumber(),
      base_currency
    }
  })

  // Plan vs actual for the subscription schedules: the plan is what the active
  // rules ask for in the month (skipped occurrences are not asked for), the
  // actual is what the ledger booked for those rules — a payment made with a
  // different amount shows up there. Paused rules drop out of the plan but keep
  // whatever they already paid in the actual.
  fastify.get('/reports/recurring-plan', { schema: { querystring: dateRangeSchema } }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const window = resolveProjectionWindow(request.query.from, request.query.to)
    if (!window.ok) {
      reply.code(400)
      return { error: t(`errors.${window.error}`, {}, lang) }
    }
    const { base_currency = 'USD' } = request.query
    const [rules, visible, rates] = await Promise.all([
      loadVisibleRules(fastify.db, userId, { order: 'r.id ASC' }),
      visibleAccountIds(fastify.db, userId),
      loadRates(fastify.db)
    ])
    const activeRules = rules.filter(rule => rule.is_active)
    const flags = await loadOccurrenceFlags(fastify.db, activeRules.map(rule => rule.id))

    const months = calendarMonths(window.from, window.to)
    const empty = () => new Map(months.map(key => [key, { income: new Decimal(0), expense: new Decimal(0) }]))
    const planned = empty()
    const booked = empty()

    for (const occurrence of projectOccurrences(activeRules, flags, window.from, window.to)) {
      if (occurrence.skipped) continue
      const side = occurrence.type === 'income' ? 'income' : 'expense'
      planned.get(occurrence.date.slice(0, 7))[side] = planned.get(occurrence.date.slice(0, 7))[side]
        .plus(sumInBase(occurrence.amount, occurrence.currency, base_currency, rates))
    }

    const where = `t.recurring_rule_id IS NOT NULL AND t.date >= $${2} AND t.date <= $${3}`
    const groups = await fetchTotalsByMonth(visible, where, [window.from, window.to])
    for (const g of groups) {
      if (!booked.has(g.month) || (g.type !== 'income' && g.type !== 'expense')) continue
      const side = g.type === 'income' ? 'income' : 'expense'
      booked.get(g.month)[side] = booked.get(g.month)[side].plus(sumInBase(g.sum, g.account_currency, base_currency, rates))
    }

    const money = value => toDisplayNumber(value, base_currency)
    return {
      from: window.from,
      to: window.to,
      base_currency,
      months: months.map(key => ({
        month: key,
        plan_income: money(planned.get(key).income),
        plan_expense: money(planned.get(key).expense),
        actual_income: money(booked.get(key).income),
        actual_expense: money(booked.get(key).expense)
      }))
    }
  })
}

export default reportRoutes
