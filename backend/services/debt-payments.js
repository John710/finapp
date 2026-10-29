import Decimal from 'decimal.js'
import { convertAmountDecimal } from './currency.js'
import { t, getUserLang } from './i18n.js'
import { accountForWrite } from './visibility.js'
import { notify } from './notify.js'
import { projectInstallments } from './debt-schedule.js'

/**
 * Sum of a debt's payments in the debt's own currency, as an exact Decimal.
 * A payment without a usable rate counts at its raw amount (onMissingRate is
 * told about it) so a missing rate never makes a debt look unpaid.
 */
export function paidInDebtCurrency(payments, debtCurrency, rates, onMissingRate) {
  let paid = new Decimal(0)
  for (const p of payments) {
    const paymentCurrency = p.currency || debtCurrency
    const converted = convertAmountDecimal(p.amount, paymentCurrency, debtCurrency, rates)
    if (converted === null) {
      if (onMissingRate) onMissingRate(p, paymentCurrency)
      paid = paid.plus(new Decimal(p.amount))
    } else {
      paid = paid.plus(converted)
    }
  }
  return paid
}

// What is still owed on a debt; never negative (overpayment means settled).
export function remainingOnDebt(amount, paid) {
  const remaining = new Decimal(amount).minus(paid)
  return remaining.isNegative() ? new Decimal(0) : remaining
}

// Amount of a debt booking in the target account's currency, exact. null when
// no rate links the two currencies — the caller answers 400 instead of booking
// the raw number in the wrong currency (100 USD must never become 100 BTC).
export function convertForAccount(amount, fromCurrency, accountCurrency, rates) {
  if (!fromCurrency || !accountCurrency || fromCurrency === accountCurrency) return new Decimal(amount)
  return convertAmountDecimal(amount, fromCurrency, accountCurrency, rates)
}

// Creating a debt books money the other way round from paying it back: lending
// is an expense now and an income when repaid; borrowing the opposite.
export const bookingType = debtType => (debtType === 'borrow' ? 'income' : 'expense')
export const paymentType = debtType => (debtType === 'borrow' ? 'expense' : 'income')
export const signOf = txType => (txType === 'income' ? 1 : -1)

// A debt shared both to the whole family and to the user directly has two
// share rows; visibility is an EXISTS so the debt is listed once. $1 is the
// caller.
export const DEBT_VISIBLE_SQL = `(d.user_id = $1 OR EXISTS (
  SELECT 1 FROM entity_shares es
  WHERE es.entity_type = 'debt' AND es.entity_id = d.id AND es.owner_id = d.user_id
    AND (es.shared_with = $1 OR es.shared_with IS NULL)
))`

// 'edit' for the owner, else the most permissive share the caller holds
// ('edit' | 'view'), else 'none'. `param` is the caller's placeholder.
export function debtAccessSql(param) {
  return `CASE WHEN d.user_id = ${param} THEN 'edit' ELSE COALESCE((SELECT es.permission FROM entity_shares es
                  WHERE es.entity_type = 'debt' AND es.entity_id = d.id AND es.owner_id = d.user_id
                    AND (es.shared_with = ${param} OR es.shared_with IS NULL)
                  ORDER BY (es.permission = 'edit') DESC LIMIT 1), 'none') END`
}

/**
 * The debt row locked for a write, with the caller's access to it. The lock
 * serialises every writer of one debt (payments, schedule edits), so the
 * automatic 'paid' status sees every payment. null when the debt is gone.
 */
export async function lockDebt(client, debtId, userId) {
  const { rows } = await client.query(
    `SELECT d.id, d.amount, d.currency, d.type, d.name, d.status, d.account_id, d.user_id AS owner_id,
            ${debtAccessSql('$2')} AS access
     FROM debts d WHERE d.id = $1
     FOR UPDATE OF d`,
    [debtId, userId]
  )
  return rows[0] ?? null
}

export async function getDebtCategoryId(client, txType, userId) {
  const lang = await getUserLang(client, userId)
  const catName = t('debts.title', {}, lang)
  // 'Title' is the fallback name persisted before the debts.title locale key
  // existed — treat it as legacy so those categories are reused, not duplicated.
  const legacyNames = txType === 'income'
    ? ['Debts (income)', 'Долги (доход)', 'Title']
    : ['Debts (expense)', 'Долги (расход)', 'Title']
  let res = await client.query('SELECT id FROM categories WHERE name = $1 AND type = $2', [catName, txType])
  if (res.rows.length) return res.rows[0].id
  for (const name of legacyNames) {
    res = await client.query('SELECT id FROM categories WHERE name = $1 AND type = $2', [name, txType])
    if (res.rows.length) return res.rows[0].id
  }
  const newRes = await client.query(
    'INSERT INTO categories (name, type, color, icon) VALUES ($1, $2, $3, $4) RETURNING id',
    [catName, txType, '#64748b', 'tag']
  )
  return newRes.rows[0].id
}

/**
 * Records one payment on a debt that the caller locked with lockDebt() and
 * holds edit access to, inside the caller's BEGIN … COMMIT:
 *  - the debt_payments row, stored under the debt's owner (created_by = payer);
 *  - with an account, the transaction on it and its balance effect, in the
 *    account's currency;
 *  - the debt's automatic 'paid' status once the payments cover it.
 * Returns { payment, transaction, fullyPaid }, or { error, params } with an
 * errors.* key ('account_not_found' → 404, 'exchange_rate_missing' → 400)
 * after which the caller rolls back. Notifications are the caller's, after
 * COMMIT (notifyDebtPaid).
 *
 * The transaction is not linked to the payment by id: both rows are inserted in
 * one DB transaction, so they share created_at (now() is fixed per transaction)
 * — findPaymentTransactions() pairs them on that, the way the creation booking
 * is paired with its debt.
 */
export async function recordDebtPayment(client, { debt, userId, amount, currency, note, accountId, installmentId = null, rates, log }) {
  const debtCurrency = debt.currency || 'USD'
  const paymentCurrency = currency || debtCurrency
  const value = new Decimal(amount)

  let account = null
  let txAmount = null
  if (accountId) {
    account = await accountForWrite(client, userId, accountId)
    if (!account) return { error: 'account_not_found' }
    txAmount = convertForAccount(value, paymentCurrency, account.currency, rates)
    if (txAmount === null) return { error: 'exchange_rate_missing', params: { from: paymentCurrency, to: account.currency } }
  }

  const paymentRes = await client.query(
    'INSERT INTO debt_payments (user_id, debt_id, amount, currency, note, account_id, created_by, installment_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [debt.owner_id, debt.id, value.toFixed(), paymentCurrency, note ?? null, accountId ?? null, userId, installmentId]
  )

  let transaction = null
  if (account) {
    const txType = paymentType(debt.type)
    const categoryId = await getDebtCategoryId(client, txType, userId)
    const txRes = await client.query(
      'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, created_by) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7) RETURNING *',
      [account.owner_id, account.id, categoryId, txAmount.toFixed(), txType, `debt_payment:${debt.name}`, userId]
    )
    transaction = txRes.rows[0] ?? null
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
      [txAmount.times(signOf(txType)).toFixed(), account.id, account.owner_id]
    )
  }

  const paymentsRes = await client.query('SELECT amount, currency FROM debt_payments WHERE debt_id = $1', [debt.id])
  const paid = paidInDebtCurrency(paymentsRes.rows, debtCurrency, rates, (p, pCurrency) => {
    log?.warn(`Debt payment conversion failed on full-paid check: ${pCurrency} -> ${debtCurrency}`)
  })
  let fullyPaid = false
  if (paid.gte(new Decimal(debt.amount))) {
    await client.query('UPDATE debts SET status = $1 WHERE id = $2', ['paid', debt.id])
    fullyPaid = true
  }
  return { payment: paymentRes.rows[0], transaction, fullyPaid }
}

// Bell, push and Shoutrrr to the debt's owner. Network I/O: only ever call it
// after COMMIT, with the pooled client released.
export async function notifyDebtPaid(fastify, debt) {
  try {
    const lang = await getUserLang(fastify.db, debt.owner_id)
    await notify(fastify, debt.owner_id, {
      type: 'debt_paid',
      title: t('notifications.debt_paid', {}, lang),
      message: t('notifications.debt_paid_body', { name: debt.name }, lang),
      data: { entity_id: debt.id, url: '/debts' },
      channels: ['bell', 'push', 'shoutrrr']
    })
  } catch (err) {
    fastify.log.warn(err, 'Debt paid notification failed')
  }
}

/**
 * The transactions recorded with the given payments, locked, one per payment
 * at most: same account and created_at as the payment, a 'debt_payment:' note
 * (by prefix — the debt may have been renamed since). `untouched` is false once
 * the transactions route rewrote the row (it bumps updated_at) or split it;
 * such rows are the user's now and are never reversed automatically. A payment
 * whose transaction was deleted or moved to another account has no entry.
 */
export async function findPaymentTransactions(client, paymentIds) {
  if (paymentIds.length === 0) return new Map()
  const { rows } = await client.query(
    `SELECT p.id AS payment_id, t.id, t.account_id, t.user_id, t.amount::text AS amount, t.type,
            (t.updated_at = t.created_at AND NOT t.is_split) AS untouched
     FROM debt_payments p
     JOIN transactions t ON t.account_id = p.account_id AND t.created_at = p.created_at
       AND starts_with(t.note, 'debt_payment:') AND t.parent_id IS NULL
     WHERE p.id = ANY($1::int[])
     ORDER BY p.id, t.id
     FOR UPDATE OF t`,
    [paymentIds]
  )
  const byPayment = new Map()
  for (const row of rows) {
    if (!byPayment.has(row.payment_id)) byPayment.set(row.payment_id, row)
  }
  return byPayment
}

// Deletes a debt transaction and takes its effect off its account's balance —
// what DELETE /transactions does for a plain income/expense row.
export async function reverseTransaction(client, tx) {
  await client.query('DELETE FROM transactions WHERE id = $1', [tx.id])
  await client.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
    [new Decimal(tx.amount).times(signOf(tx.type)).toFixed(), tx.account_id, tx.user_id]
  )
}

// Installment columns as the API returns them; DATE columns as 'YYYY-MM-DD'.
export const INSTALLMENT_COLUMNS =
  'i.id, i.debt_id, i.user_id, i.position, i.due_date::text AS due_date, i.amount::text AS amount, i.status, i.paid_on::text AS paid_on, i.note'

/**
 * Debts the user may see (own + shared to them), with is_owner. Shared by the
 * calendar projection and the iCal feed so both read one scope.
 */
export async function loadVisibleDebts(db, userId) {
  const { rows } = await db.query(
    `SELECT d.id, d.user_id, d.name, d.counterparty, d.amount::text AS amount, d.currency, d.type, d.status,
            d.account_id, (d.user_id = $1) AS is_owner
     FROM debts d
     WHERE ${DEBT_VISIBLE_SQL}
     ORDER BY d.id`,
    [userId]
  )
  return rows
}

// Installments of the given debts, by debt then position; optionally only
// those due within [from, to].
export async function loadDebtInstallments(db, debtIds, { from, to } = {}) {
  if (debtIds.length === 0) return []
  const range = from && to
  const { rows } = await db.query(
    `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments i
     WHERE i.debt_id = ANY($1::int[])${range ? ' AND i.due_date BETWEEN $2::date AND $3::date' : ''}
     ORDER BY i.debt_id, i.position`,
    range ? [debtIds, from, to] : [debtIds]
  )
  return rows
}

/**
 * The debt half of the calendar: installment rows (kind 'debt_installment') of
 * the debts the user sees, within an already validated window
 * (resolveProjectionWindow). Paid-off debts are left out.
 */
export async function loadInstallmentOccurrences(db, userId, from, to) {
  const debts = (await loadVisibleDebts(db, userId)).filter(debt => debt.status !== 'paid')
  const installments = await loadDebtInstallments(db, debts.map(debt => debt.id), { from, to })
  return projectInstallments(debts, installments, from, to)
}
