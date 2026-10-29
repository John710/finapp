import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import recurringRoutes from '../routes/recurring.js'
import dashboardRoutes from '../routes/dashboard.js'
import { buildStubServer, TEST_USER as USER } from './helpers/stub-db.js'

// Debt installments in the one calendar projection: GET /recurring/occurrences,
// the dashboard's upcoming card and the iCal feed all read
// loadInstallmentOccurrences() and merge it with the subscriptions. The stub db
// answers the debt and installment lookups the way PostgreSQL would for the
// given scope, and checks every statement's bind count.

const OTHER = 99
const TODAY = '2026-03-05'

function rule(overrides = {}) {
  return {
    id: 1,
    user_id: USER,
    account_id: 3,
    category_id: 5,
    amount: '20.000000000000',
    currency: 'USD',
    type: 'expense',
    frequency: 'monthly',
    interval_unit: 'month',
    interval_value: 1,
    billing_anchor_day: 10,
    start_date: '2026-01-10',
    next_date: '2026-03-10',
    end_date: null,
    cancellation_date: null,
    auto_renew: true,
    payment_limit: null,
    occurrences_paid: 0,
    last_run_date: null,
    notify_days_before: 0,
    note: 'Gym',
    is_active: true,
    account_name: 'Checking',
    category_name: 'Sport',
    owner_login: null,
    is_owner: true,
    is_shared: false,
    ...overrides
  }
}

// Rows of loadVisibleDebts(): what DEBT_VISIBLE_SQL lets the caller see.
const DEBTS = [
  { id: 4, user_id: USER, name: 'Car loan', counterparty: 'Bank', amount: '300.000000000000', currency: 'USD', type: 'borrow', status: 'active', account_id: 3, is_owner: true, can_edit: true },
  // shared to the caller by another family member with an 'edit' share
  { id: 5, user_id: OTHER, name: 'Lent', counterparty: 'Ann', amount: '50.000000000000', currency: 'EUR', type: 'lend', status: 'active', account_id: 8, is_owner: false, can_edit: true },
  // paid off: its installments are closed by money and stay out
  { id: 6, user_id: USER, name: 'Old', counterparty: 'Tom', amount: '10.000000000000', currency: 'USD', type: 'borrow', status: 'paid', account_id: null, is_owner: true, can_edit: true },
  // no schedule: never in the calendar
  { id: 7, user_id: USER, name: 'Plain', counterparty: 'Sue', amount: '70.000000000000', currency: 'USD', type: 'lend', status: 'active', account_id: null, is_owner: true, can_edit: true }
]

const INSTALLMENTS = [
  { id: 41, debt_id: 4, user_id: USER, position: 1, due_date: '2026-03-10', amount: '100.000000000000', status: 'paid', paid_on: '2026-03-01', note: null },
  { id: 42, debt_id: 4, user_id: USER, position: 2, due_date: '2026-04-10', amount: '100.000000000000', status: 'skipped', paid_on: null, note: null },
  { id: 43, debt_id: 4, user_id: USER, position: 3, due_date: '2026-05-10', amount: '100.000000000000', status: 'due', paid_on: null, note: null },
  { id: 51, debt_id: 5, user_id: OTHER, position: 1, due_date: '2026-03-10', amount: '50.000000000000', status: 'due', paid_on: null, note: null },
  { id: 61, debt_id: 6, user_id: USER, position: 1, due_date: '2026-03-12', amount: '10.000000000000', status: 'paid', paid_on: '2026-03-01', note: null }
]

// The installment query filters by debt ids and the window, as PostgreSQL does.
function installmentRows(params) {
  const [ids, from, to] = params
  return INSTALLMENTS.filter(i => ids.includes(i.debt_id) && (!from || (i.due_date >= from && i.due_date <= to)))
}

const debtHandlers = [
  { match: /FROM debts d\s+WHERE/, rows: () => DEBTS },
  { match: /FROM debt_installments i/, rows: installmentRows }
]

function calendarServer(rules = [rule()]) {
  return buildStubServer(recurringRoutes, [
    { match: /CURRENT_DATE/, rows: () => [{ today: TODAY }] },
    { match: /FROM recurring_rules/, rows: () => rules },
    { match: /FROM transactions WHERE recurring_rule_id/, rows: () => [] },
    { match: /FROM recurring_exceptions/, rows: () => [] },
    ...debtHandlers
  ])
}

const label = o => `${o.date}:${o.kind}:${o.rule_id ?? o.installment_id}`

describe('GET /recurring/occurrences with debt installments', () => {
  it('returns subscriptions and installments in one list, by date, kind and id', async () => {
    const { app } = calendarServer()
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-03-01&to=2026-05-31' })
    expect(res.statusCode).toBe(200)
    const { occurrences } = res.json()
    expect(occurrences.map(label)).toEqual([
      '2026-03-10:debt_installment:41',
      '2026-03-10:debt_installment:51',
      '2026-03-10:subscription:1',
      '2026-04-10:debt_installment:42',
      '2026-04-10:subscription:1',
      '2026-05-10:debt_installment:43',
      '2026-05-10:subscription:1'
    ])
    await app.close()
  })

  it('shapes both kinds as the calendar contract says', async () => {
    const { app } = calendarServer()
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-03-01&to=2026-03-31' })
    const { occurrences } = res.json()
    expect(occurrences.find(o => o.kind === 'subscription')).toEqual({
      kind: 'subscription',
      rule_id: 1,
      user_id: USER,
      name: 'Gym',
      date: '2026-03-10',
      amount: '20.000000000000',
      currency: 'USD',
      type: 'expense',
      account_id: 3,
      account_name: 'Checking',
      category_name: 'Sport',
      paid: false,
      skipped: false,
      is_active: true,
      is_owner: true,
      can_edit: true
    })
    expect(occurrences.find(o => o.installment_id === 41)).toEqual({
      kind: 'debt_installment',
      installment_id: 41,
      debt_id: 4,
      user_id: USER,
      name: 'Car loan · Bank',
      date: '2026-03-10',
      amount: '100.000000000000',
      currency: 'USD',
      debt_type: 'borrow',
      paid: true,
      skipped: false,
      is_owner: true,
      can_edit: true
    })
    await app.close()
  })

  it('marks a shared debt\'s installment as not the caller\'s and carries skipped', async () => {
    const { app } = calendarServer([])
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-03-01&to=2026-05-31' })
    const { occurrences } = res.json()
    // an 'edit' share may pay and skip: can_edit, though not the owner
    expect(occurrences.find(o => o.installment_id === 51)).toMatchObject({ is_owner: false, can_edit: true, user_id: OTHER, currency: 'EUR', debt_type: 'lend' })
    expect(occurrences.find(o => o.installment_id === 42)).toMatchObject({ paid: false, skipped: true })
    await app.close()
  })

  it('leaves out paid-off debts and debts without a schedule', async () => {
    const { app, queries } = calendarServer([])
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-03-01&to=2026-05-31' })
    const { occurrences } = res.json()
    expect(occurrences.some(o => o.debt_id === 6)).toBe(false)
    expect(occurrences.some(o => o.debt_id === 7)).toBe(false)
    const installments = queries.find(q => /FROM debt_installments/.test(q.sql))
    // the paid-off debt is not even asked for
    expect(installments.params).toEqual([[4, 5, 7], '2026-03-01', '2026-05-31'])
    expect(installments.sql).toContain('i.due_date::text AS due_date')
    await app.close()
  })

  it('scopes the debts by the caller, shares included once', async () => {
    const { app, queries } = calendarServer([])
    await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-03-01&to=2026-03-31' })
    const debts = queries.find(q => /FROM debts d/.test(q.sql))
    expect(debts.params).toEqual([USER])
    expect(debts.sql).toContain('d.user_id = $1 OR EXISTS')
    expect(debts.sql).toContain('es.shared_with = $1 OR es.shared_with IS NULL')
    expect(debts.sql).not.toMatch(/JOIN entity_shares/)
    // can_edit: the owner, else the most permissive share the caller holds is 'edit'
    expect(debts.sql).toMatch(/\(CASE WHEN d\.user_id = \$1 THEN 'edit' ELSE COALESCE\(\(SELECT es\.permission .*'none'\) END\) = 'edit' AS can_edit/)
    await app.close()
  })

  it('gives a subscription chip can_edit only for the owner, whose routes alone pay and skip', async () => {
    const { app } = calendarServer([rule({ id: 2, user_id: OTHER, is_owner: false })])
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-03-01&to=2026-03-31' })
    const shared = res.json().occurrences.find(o => o.kind === 'subscription')
    expect(shared).toMatchObject({ rule_id: 2, is_owner: false, can_edit: false })
    await app.close()
  })

  it('refuses an over-wide window before reading any debt', async () => {
    const { app, queries } = calendarServer()
    const res = await app.inject({ method: 'GET', url: '/recurring/occurrences?from=2026-01-01&to=2027-06-01' })
    expect(res.statusCode).toBe(400)
    expect(queries.some(q => /FROM debts|FROM debt_installments/.test(q.sql))).toBe(false)
    await app.close()
  })
})

describe('GET /reports/dashboard upcoming with debt installments', () => {
  function dashboardServer(rules = [rule()]) {
    return buildStubServer(dashboardRoutes, [
      { match: /CURRENT_DATE/, rows: () => [{ today: TODAY }] },
      { match: /FROM recurring_rules/, rows: () => rules },
      { match: /FROM transactions WHERE recurring_rule_id/, rows: () => [] },
      { match: /FROM recurring_exceptions/, rows: () => [] },
      ...debtHandlers
    ])
  }

  it('lists the due installments next to the subscriptions, settled ones left out', async () => {
    const { app, queries } = dashboardServer()
    const res = await app.inject({ method: 'GET', url: '/reports/dashboard' })
    expect(res.statusCode).toBe(200)
    const { recurring } = res.json()
    // window 2026-03-05 .. 2026-05-04: 41 is paid and 42 skipped, 43 is past the horizon
    expect(recurring.window).toEqual({ from: TODAY, to: '2026-05-04' })
    expect(recurring.upcoming.map(label)).toEqual([
      '2026-03-10:debt_installment:51',
      '2026-03-10:subscription:1',
      '2026-04-10:subscription:1'
    ])
    const installments = queries.find(q => /FROM debt_installments/.test(q.sql))
    expect(installments.params).toEqual([[4, 5, 7], TODAY, '2026-05-04'])
    await app.close()
  })

  it('keeps installments out of the monthly commitments', async () => {
    const { app } = dashboardServer()
    const res = await app.inject({ method: 'GET', url: '/reports/dashboard' })
    expect(res.json().recurring.monthly_commitments).toBe(20)
    await app.close()
  })

  it('applies the upcoming limit to the merged list', async () => {
    const { app } = dashboardServer()
    const res = await app.inject({ method: 'GET', url: '/reports/dashboard?upcoming_limit=1' })
    expect(res.json().recurring.upcoming.map(label)).toEqual(['2026-03-10:debt_installment:51'])
    await app.close()
  })
})

describe('GET /recurring.ics with debt installments', () => {
  const TOKEN = '3f2b1c9a-7d4e-4c1b-9a6f-0e2d5b8c1a44'
  const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex')

  function feedServer({ visibleAccounts = [3] } = {}) {
    return buildStubServer(recurringRoutes, [
      { match: /FROM recurring_feed_tokens/, rows: (params) => (params[0] === TOKEN_HASH ? [{ id: 9, user_id: USER }] : []) },
      { match: /CURRENT_DATE/, rows: () => [{ today: TODAY }] },
      { match: /FROM recurring_rules/, rows: () => [] },
      { match: /UNION/, rows: () => visibleAccounts.map(id => ({ id })) },
      {
        match: /FROM debts d JOIN accounts a/,
        rows: ([debtIds, visible]) => DEBTS
          .filter(d => debtIds.includes(d.id) && d.account_id && visible.includes(d.account_id))
          .map(d => ({ debt_id: d.id, account_name: `Account ${d.account_id}` }))
      },
      ...debtHandlers
    ])
  }

  const unfold = text => text.replace(/\r\n /g, '').split('\r\n')

  it('publishes installments under their own UID, paid marked and skipped left out', async () => {
    const { app } = feedServer()
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    expect(res.statusCode).toBe(200)
    const lines = unfold(res.body)
    expect(lines.filter(l => l.startsWith('UID:'))).toEqual([
      `UID:finapp-debt-${USER}-41-2026-03-10@finapp`,
      `UID:finapp-debt-${OTHER}-51-2026-03-10@finapp`,
      `UID:finapp-debt-${USER}-43-2026-05-10@finapp`
    ])
    expect(res.body).toContain('X-FINAPP-PAID:20260310')
    expect(res.body.match(/X-FINAPP-PAID/g)).toHaveLength(1)
    // 42 is skipped; 61 belongs to a paid-off debt
    expect(res.body).not.toContain('-42-')
    expect(res.body).not.toContain('-61-')
    expect(lines).toContain('SUMMARY:Car loan · Bank')
  })

  it('names the debt account only when the feed owner can see it', async () => {
    const { app, queries } = feedServer({ visibleAccounts: [3] })
    const res = await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    const descriptions = unfold(res.body).filter(l => l.startsWith('DESCRIPTION:'))
    expect(descriptions).toEqual([
      'DESCRIPTION:100 · USD · Account 3',
      // debt 5's account 8 is its owner's, not shared with the caller
      'DESCRIPTION:50 · EUR',
      'DESCRIPTION:100 · USD · Account 3'
    ])
    const names = queries.find(q => /FROM debts d JOIN accounts a/.test(q.sql))
    expect(names.params).toEqual([[4, 5], [3]])
  })

  it('projects installments over the 180-day feed window from today', async () => {
    const { app, queries } = feedServer()
    await app.inject({ method: 'GET', url: `/recurring.ics?token=${TOKEN}` })
    const installments = queries.find(q => /FROM debt_installments/.test(q.sql))
    expect(installments.params.slice(1)).toEqual([TODAY, '2026-09-01'])
    const debts = queries.find(q => /FROM debts d\s+WHERE/.test(q.sql))
    expect(debts.params).toEqual([USER])
  })
})
