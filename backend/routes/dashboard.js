import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal } from '../services/currency.js'
import { visibleAccountIds } from '../services/visibility.js'
import { loadOccurrenceFlags, loadVisibleRules } from '../services/recurring-rules.js'
import { monthlyEquivalent, projectOccurrences, shiftDays } from '../services/recurring-schedule.js'

// The dashboard card answers "what is coming next", so it looks a horizon ahead
// instead of the whole calendar window the projection endpoint allows.
const RECURRING_HORIZON_DAYS = 60

async function dashboardRoutes(fastify, opts) {
  // One endpoint for the dashboard mount instead of ~11 parallel requests.
  // All aggregation is SQL-side; conversions are grouped per currency.
  fastify.get('/reports/dashboard', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          base_currency: { type: 'string', pattern: '^[A-Z]{3}$', default: 'USD' },
          trend_months: { type: 'integer', minimum: 1, maximum: 24, default: 6 },
          networth_months: { type: 'integer', minimum: 1, maximum: 120, default: 12 },
          recent_limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
          upcoming_limit: { type: 'integer', minimum: 1, maximum: 20, default: 6 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { base_currency = 'USD', trend_months = 6, networth_months = 12, recent_limit = 5, upcoming_limit = 6 } = request.query
    const rates = await loadRates(fastify.db)
    const visible = await visibleAccountIds(fastify.db, userId)

    const toBase = (amount, currency) => {
      if (!currency || currency === base_currency) return new Decimal(amount)
      const converted = convertAmountDecimal(amount, currency, base_currency, rates)
      return converted !== null ? converted : new Decimal(amount)
    }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const trendStart = new Date(now.getFullYear(), now.getMonth() - (trend_months - 1), 1).toISOString().slice(0, 10)
    const today = now.toISOString().slice(0, 10)

    const [monthTotals, trendGroups, accountsRes, recentRes, recurringRules, debtsRes, todayRes] = await Promise.all([
      // Current-month income/expense (split children excluded: parents carry the flow)
      fastify.db.query(
        `SELECT t.type, a.currency, COALESCE(SUM(t.amount), 0) as sum
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.account_id = ANY($1) AND t.parent_id IS NULL AND t.date >= $2 AND t.date <= $3
         GROUP BY t.type, a.currency`,
        [visible, monthStart, today]
      ),
      // Monthly trend
      fastify.db.query(
        `SELECT to_char(t.date, 'YYYY-MM') as month, t.type, a.currency, COALESCE(SUM(t.amount), 0) as sum
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.account_id = ANY($1) AND t.parent_id IS NULL AND t.date >= $2 AND t.date <= $3
         GROUP BY 1, t.type, a.currency`,
        [visible, trendStart, today]
      ),
      fastify.db.query(
        `SELECT a.id, a.name, a.type, a.currency, a.balance, a.color, a.icon, a.is_archived,
                CASE WHEN a.user_id = $1 THEN NULL ELSE ou.login END AS owner_login,
                CASE WHEN a.user_id = $1 THEN COALESCE((SELECT true FROM entity_shares es WHERE es.entity_type = 'account' AND es.entity_id = a.id AND es.owner_id = a.user_id LIMIT 1), false) ELSE false END AS is_shared,
                CASE WHEN a.user_id = $1 THEN 'owner' ELSE COALESCE(es.permission, 'view') END AS access
         FROM accounts a
         JOIN users ou ON ou.id = a.user_id
         LEFT JOIN entity_shares es ON es.entity_type = 'account' AND es.entity_id = a.id
           AND es.owner_id = a.user_id AND (es.shared_with = $1 OR es.shared_with IS NULL)
         WHERE a.user_id = $1 OR es.id IS NOT NULL
         ORDER BY a.is_archived, a.sort_order, a.created_at DESC`,
        [userId]
      ),
      fastify.db.query(
        `SELECT t.id, t.amount, t.type, t.date, t.note, t.is_split, t.account_id, t.transfer_to_account_id,
                a.name as account_name, a.currency as account_currency, c.name as category_name, c.color as category_color, c.icon as category_icon,
                CASE WHEN t.user_id = $1 THEN NULL ELSE ou.login END AS owner_login
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN users ou ON ou.id = t.user_id
         WHERE t.account_id = ANY($1)
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT $2`,
        [visible, recent_limit]
      ),
      // The schedule contract lives in the recurring service modules: rules read
      // through ruleColumns() give text dates, so no container timezone moves a day.
      loadVisibleRules(fastify.db, userId),
      fastify.db.query(
        `SELECT d.id, d.name, d.counterparty, d.amount, d.currency, d.type, d.status, d.due_date,
                CASE WHEN d.user_id = $1 THEN NULL ELSE ou.login END AS owner_login
         FROM debts d
         JOIN users ou ON ou.id = d.user_id
         LEFT JOIN entity_shares es ON es.entity_type = 'debt' AND es.entity_id = d.id
           AND es.owner_id = d.user_id AND (es.shared_with = $1 OR es.shared_with IS NULL)
         WHERE d.user_id = $1 OR es.id IS NOT NULL
         ORDER BY d.due_date ASC NULLS LAST`,
        [userId]
      ),
      // The schedule contract is defined against the database clock, so the card
      // and the Recurring page cannot disagree about which day is today.
      fastify.db.query('SELECT CURRENT_DATE::text AS today')
    ])

    // Month summary
    let monthIncome = new Decimal(0)
    let monthExpense = new Decimal(0)
    for (const g of monthTotals.rows) {
      const val = toBase(g.sum, g.currency)
      if (g.type === 'income') monthIncome = monthIncome.plus(val)
      else if (g.type === 'expense') monthExpense = monthExpense.plus(val)
    }

    // Trend by month
    const trendMap = new Map()
    for (const g of trendGroups.rows) {
      if (!trendMap.has(g.month)) trendMap.set(g.month, { month: g.month, income: new Decimal(0), expense: new Decimal(0), transfer: new Decimal(0) })
      const m = trendMap.get(g.month)
      const val = toBase(g.sum, g.currency)
      if (g.type === 'income') m.income = m.income.plus(val)
      else if (g.type === 'expense') m.expense = m.expense.plus(val)
      else if (g.type === 'transfer') m.transfer = m.transfer.plus(val)
    }

    // Net worth anchored to current balances, walked backwards
    let currentTotal = new Decimal(0)
    const balancesByMonth = new Map()
    for (const acc of accountsRes.rows) {
      currentTotal = currentTotal.plus(toBase(acc.balance, acc.currency))
    }
    const flowByMonth = new Map()
    for (const g of trendGroups.rows) {
      // trendGroups only cover the trend window; net worth needs ALL flows
    }
    const allFlowGroups = await fastify.db.query(
      `SELECT to_char(t.date, 'YYYY-MM') as month, t.type, a.currency, COALESCE(SUM(t.amount), 0) as sum
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id = ANY($1) AND t.parent_id IS NULL
       GROUP BY 1, t.type, a.currency`,
      [visible]
    )
    for (const g of allFlowGroups.rows) {
      const val = toBase(g.sum, g.currency).times(g.type === 'income' ? 1 : -1)
      flowByMonth.set(g.month, (flowByMonth.get(g.month) || new Decimal(0)).plus(val))
    }

    const start = new Date(now.getFullYear(), now.getMonth() - (networth_months - 1), 1)
    const monthsList = []
    for (let d = new Date(start); d <= now; d.setMonth(d.getMonth() + 1)) {
      monthsList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const lastMonth = monthsList[monthsList.length - 1]
    let suffixFlow = new Decimal(0)
    for (const [m, f] of flowByMonth) {
      if (m > lastMonth) suffixFlow = suffixFlow.plus(f)
    }
    const netWorth = []
    let bal = currentTotal.minus(suffixFlow)
    for (let i = monthsList.length - 1; i >= 0; i--) {
      netWorth.unshift({ month: monthsList[i], balance: parseFloat(bal.toNumber().toFixed(2)) })
      bal = bal.minus(flowByMonth.get(monthsList[i]) || new Decimal(0))
    }

    // Debts (unpaid totals in base currency)
    let owed = new Decimal(0)
    let lent = new Decimal(0)
    for (const d of debtsRes.rows) {
      if (d.status === 'paid') continue
      const val = toBase(d.amount, d.currency || base_currency)
      if (d.type === 'borrow') owed = owed.plus(val)
      else lent = lent.plus(val)
    }

    // Recurring: what the active schedules are worth per month, and what they
    // ask for next. Paid and skipped occurrences are settled business, so the
    // list only carries the ones still outstanding.
    const serverToday = todayRes.rows[0]?.today ?? today
    const activeRules = recurringRules.filter(r => r.is_active)
    const flags = await loadOccurrenceFlags(fastify.db, activeRules.map(r => r.id))
    let commitments = new Decimal(0)
    for (const rule of activeRules) {
      if (rule.type !== 'expense') continue
      commitments = commitments.plus(toBase(monthlyEquivalent(rule), rule.currency || base_currency))
    }
    const horizon = shiftDays(serverToday, RECURRING_HORIZON_DAYS)
    const upcomingOccurrence = projectOccurrences(activeRules, flags, serverToday, horizon)
      .filter(o => !o.paid && !o.skipped)
      .slice(0, upcoming_limit)

    return {
      month_summary: {
        income: parseFloat(monthIncome.toNumber().toFixed(2)),
        expense: parseFloat(monthExpense.toNumber().toFixed(2)),
        net: parseFloat(monthIncome.minus(monthExpense).toNumber().toFixed(2))
      },
      total_balance: parseFloat(currentTotal.toNumber().toFixed(2)),
      trend: Array.from(trendMap.values())
        .sort((a, b) => a.month.localeCompare(b.month))
        .map(m => ({
          month: m.month,
          income: parseFloat(m.income.toNumber().toFixed(2)),
          expense: parseFloat(m.expense.toNumber().toFixed(2)),
          transfer: parseFloat(m.transfer.toNumber().toFixed(2))
        })),
      net_worth: netWorth,
      accounts: accountsRes.rows,
      recent_transactions: recentRes.rows,
      recurring: {
        monthly_commitments: parseFloat(commitments.toNumber().toFixed(2)),
        active_count: activeRules.length,
        window: { from: serverToday, to: horizon },
        upcoming: upcomingOccurrence
      },
      debts_summary: {
        owed: parseFloat(owed.toNumber().toFixed(2)),
        lent: parseFloat(lent.toNumber().toFixed(2)),
        count: debtsRes.rows.filter(d => d.status !== 'paid').length
      },
      base_currency
    }
  })
}

export default dashboardRoutes
