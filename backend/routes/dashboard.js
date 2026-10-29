import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal, toDisplayNumber } from '../services/currency.js'
import { visibleAccountIds } from '../services/visibility.js'
import { loadOccurrenceFlags, loadVisibleRules } from '../services/recurring-rules.js'
import { mergeOccurrences, monthlyEquivalent, projectOccurrences, shiftDays, shiftMonth } from '../services/recurring-schedule.js'
import { FLOW_TYPE_SQL, flowSign } from '../services/flows.js'
import { loadInstallmentOccurrences, paidInDebtCurrency, remainingOnDebt } from '../services/debt-payments.js'

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
    // Calendar days come from the database clock (the container runs in a
    // different timezone than PostgreSQL): the month window, the trend window
    // and the recurring card all agree on which day is today.
    const [rates, visible, todayRes] = await Promise.all([
      loadRates(fastify.db),
      visibleAccountIds(fastify.db, userId),
      fastify.db.query('SELECT CURRENT_DATE::text AS today')
    ])
    const serverToday = todayRes.rows[0].today
    const currentMonth = serverToday.slice(0, 7)
    const monthStart = `${currentMonth}-01`
    const trendStart = `${shiftMonth(currentMonth, -(trend_months - 1))}-01`

    const toBase = (amount, currency) => {
      if (!currency || currency === base_currency) return new Decimal(amount)
      const converted = convertAmountDecimal(amount, currency, base_currency, rates)
      return converted !== null ? converted : new Decimal(amount)
    }
    // Exact Decimal totals become JSON numbers only here, in the response
    const display = value => toDisplayNumber(value, base_currency)

    const horizon = shiftDays(serverToday, RECURRING_HORIZON_DAYS)

    const [monthTotals, trendGroups, accountsRes, recentRes, recurringRules, debtsRes, installments] = await Promise.all([
      // Current-month income/expense (split children excluded: parents carry
      // the flow; transfer legs come back as 'transfer_in' and are not income)
      fastify.db.query(
        `SELECT ${FLOW_TYPE_SQL} as type, a.currency, COALESCE(SUM(t.amount), 0) as sum
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.account_id = ANY($1) AND t.parent_id IS NULL AND t.date >= $2 AND t.date <= $3
         GROUP BY 1, 2`,
        [visible, monthStart, serverToday]
      ),
      // Monthly trend
      fastify.db.query(
        `SELECT to_char(t.date, 'YYYY-MM') as month, ${FLOW_TYPE_SQL} as type, a.currency, COALESCE(SUM(t.amount), 0) as sum
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.account_id = ANY($1) AND t.parent_id IS NULL AND t.date >= $2 AND t.date <= $3
         GROUP BY 1, 2, 3`,
        [visible, trendStart, serverToday]
      ),
      // One row per account even when it is shared both to the whole family
      // and to the user directly; the most permissive grant wins.
      fastify.db.query(
        `SELECT a.id, a.name, a.type, a.currency, a.balance, a.color, a.icon, a.is_archived,
                CASE WHEN a.user_id = $1 THEN NULL ELSE ou.login END AS owner_login,
                CASE WHEN a.user_id = $1 THEN EXISTS (SELECT 1 FROM entity_shares es2 WHERE es2.entity_type = 'account' AND es2.entity_id = a.id AND es2.owner_id = a.user_id) ELSE false END AS is_shared,
                CASE WHEN a.user_id = $1 THEN 'owner' ELSE COALESCE(es.permission, 'view') END AS access
         FROM accounts a
         JOIN users ou ON ou.id = a.user_id
         LEFT JOIN LATERAL (
           SELECT es1.permission FROM entity_shares es1
           WHERE es1.entity_type = 'account' AND es1.entity_id = a.id AND es1.owner_id = a.user_id
             AND (es1.shared_with = $1 OR es1.shared_with IS NULL)
           ORDER BY (es1.permission = 'edit') DESC
           LIMIT 1
         ) es ON true
         WHERE a.user_id = $1 OR es.permission IS NOT NULL
         ORDER BY a.is_archived, a.sort_order, a.created_at DESC`,
        [userId]
      ),
      fastify.db.query(
        `SELECT t.id, t.amount, t.type, t.date, t.note, t.is_split, t.account_id, t.transfer_to_account_id,
                a.name as account_name, a.currency as account_currency, c.name as category_name, c.color as category_color, c.icon as category_icon,
                CASE WHEN t.user_id = $3 THEN NULL ELSE ou.login END AS owner_login
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN users ou ON ou.id = t.user_id
         WHERE t.account_id = ANY($1)
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT $2`,
        [visible, recent_limit, userId]
      ),
      // The schedule contract lives in the recurring service modules: rules read
      // through ruleColumns() give text dates, so no container timezone moves a day.
      loadVisibleRules(fastify.db, userId),
      fastify.db.query(
        `SELECT d.id, d.name, d.counterparty, d.amount, d.currency, d.type, d.status, d.due_date,
                CASE WHEN d.user_id = $1 THEN NULL ELSE ou.login END AS owner_login
         FROM debts d
         JOIN users ou ON ou.id = d.user_id
         WHERE d.user_id = $1 OR EXISTS (
           SELECT 1 FROM entity_shares es
           WHERE es.entity_type = 'debt' AND es.entity_id = d.id AND es.owner_id = d.user_id
             AND (es.shared_with = $1 OR es.shared_with IS NULL)
         )
         ORDER BY d.due_date ASC NULLS LAST`,
        [userId]
      ),
      // Debt installments due in the card's horizon, read by the loader the
      // calendar uses, so the card and the calendar list the same rows.
      loadInstallmentOccurrences(fastify.db, userId, serverToday, horizon)
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
    for (const acc of accountsRes.rows) {
      currentTotal = currentTotal.plus(toBase(acc.balance, acc.currency))
    }
    // trendGroups only cover the trend window; net worth needs ALL flows,
    // including the incoming legs of transfers (they do move balances).
    const flowByMonth = new Map()
    const allFlowGroups = await fastify.db.query(
      `SELECT to_char(t.date, 'YYYY-MM') as month, ${FLOW_TYPE_SQL} as type, a.currency, COALESCE(SUM(t.amount), 0) as sum
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id = ANY($1) AND t.parent_id IS NULL
       GROUP BY 1, 2, 3`,
      [visible]
    )
    for (const g of allFlowGroups.rows) {
      const val = toBase(g.sum, g.currency).times(flowSign(g.type))
      flowByMonth.set(g.month, (flowByMonth.get(g.month) || new Decimal(0)).plus(val))
    }

    const monthsList = []
    for (let i = networth_months - 1; i >= 0; i--) monthsList.push(shiftMonth(currentMonth, -i))
    const lastMonth = monthsList[monthsList.length - 1]
    let suffixFlow = new Decimal(0)
    for (const [m, f] of flowByMonth) {
      if (m > lastMonth) suffixFlow = suffixFlow.plus(f)
    }
    const netWorth = []
    let bal = currentTotal.minus(suffixFlow)
    for (let i = monthsList.length - 1; i >= 0; i--) {
      netWorth.unshift({ month: monthsList[i], balance: display(bal) })
      bal = bal.minus(flowByMonth.get(monthsList[i]) || new Decimal(0))
    }

    // Debts: what is still outstanding (amount minus payments) in base currency
    const openDebts = debtsRes.rows.filter(d => d.status !== 'paid')
    const paymentsRes = openDebts.length
      ? await fastify.db.query(
        'SELECT debt_id, amount, currency FROM debt_payments WHERE debt_id = ANY($1)',
        [openDebts.map(d => d.id)]
      )
      : { rows: [] }
    const paymentsByDebt = new Map()
    for (const p of paymentsRes.rows) {
      if (!paymentsByDebt.has(p.debt_id)) paymentsByDebt.set(p.debt_id, [])
      paymentsByDebt.get(p.debt_id).push(p)
    }
    let owed = new Decimal(0)
    let lent = new Decimal(0)
    for (const d of openDebts) {
      const debtCurrency = d.currency || base_currency
      const paid = paidInDebtCurrency(paymentsByDebt.get(d.id) || [], debtCurrency, rates)
      const val = toBase(remainingOnDebt(d.amount, paid), debtCurrency)
      if (d.type === 'borrow') owed = owed.plus(val)
      else lent = lent.plus(val)
    }

    // Recurring: what the active schedules are worth per month, and what they
    // and the debt installments ask for next (the calendar's merged list).
    // Paid and skipped occurrences are settled business, so the list only
    // carries the ones still outstanding. Installments are a finite schedule,
    // not a monthly rate, so they stay out of monthly_commitments.
    const activeRules = recurringRules.filter(r => r.is_active)
    const flags = await loadOccurrenceFlags(fastify.db, activeRules.map(r => r.id))
    let commitments = new Decimal(0)
    for (const rule of activeRules) {
      if (rule.type !== 'expense') continue
      // Exact per-rule figure: rounding it in its own currency first would
      // zero a small crypto rule before the conversion.
      commitments = commitments.plus(toBase(monthlyEquivalent(rule), rule.currency || base_currency))
    }
    const upcomingOccurrence = mergeOccurrences(projectOccurrences(activeRules, flags, serverToday, horizon), installments)
      .filter(o => !o.paid && !o.skipped)
      .slice(0, upcoming_limit)

    return {
      month_summary: {
        income: display(monthIncome),
        expense: display(monthExpense),
        net: display(monthIncome.minus(monthExpense))
      },
      total_balance: display(currentTotal),
      trend: Array.from(trendMap.values())
        .sort((a, b) => a.month.localeCompare(b.month))
        .map(m => ({
          month: m.month,
          income: display(m.income),
          expense: display(m.expense),
          transfer: display(m.transfer)
        })),
      net_worth: netWorth,
      accounts: accountsRes.rows,
      recent_transactions: recentRes.rows,
      recurring: {
        monthly_commitments: display(commitments),
        active_count: activeRules.length,
        window: { from: serverToday, to: horizon },
        upcoming: upcomingOccurrence
      },
      debts_summary: {
        owed: display(owed),
        lent: display(lent),
        count: openDebts.length
      },
      base_currency
    }
  })
}

export default dashboardRoutes
