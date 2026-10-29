import { t, getUserLang } from '../services/i18n.js'
import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal } from '../services/currency.js'
import { accountForWrite, visibleAccountIds, canModifyTransaction } from '../services/visibility.js'
import {
  paidInDebtCurrency,
  debtCovered,
  convertForAccount,
  bookingType,
  signOf,
  DEBT_VISIBLE_SQL,
  lockDebt,
  getDebtCategoryId,
  recordDebtPayment,
  notifyDebtPaid,
  findPaymentTransactions,
  reverseTransaction,
  INSTALLMENT_COLUMNS
} from '../services/debt-payments.js'
import {
  MAX_INSTALLMENTS,
  currencyDigits,
  splitSchedule,
  normalizeSchedule,
  parseInstallmentAmount,
  scheduleTotal,
  scheduleMatchesDebt
} from '../services/debt-schedule.js'

// Fields that are booked on the account when a debt is created: once payments
// exist they are settled history and cannot be rewritten by an edit.
export function debtBookingChanged(old, next) {
  return !new Decimal(old.amount).eq(new Decimal(next.amount)) ||
    old.currency !== next.currency ||
    old.type !== next.type ||
    (old.account_id ?? null) !== (next.account_id ?? null)
}

// The creation booking as PUT /debts/:id keeps it: the debt's type, and — when
// the account shares the debt's currency — the debt's amount. Anything else
// (or a split) was changed in the transactions view and is the user's now.
// A booking in another currency cannot be checked by amount: the rate of the
// day it was booked is not stored. A booking with a receipt attached is the
// user's too: deleting it would take the attachments with it.
export function bookingEditedByHand(booking, debt) {
  if (booking.is_split || booking.has_attachments) return true
  if (booking.type !== bookingType(debt.type)) return true
  return booking.account_currency === (debt.currency || 'USD') &&
    !new Decimal(booking.amount).eq(new Decimal(debt.amount))
}

const ID_PARAMS = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } }
}

// Hand-entered schedule rows: PUT /debts/:id/installments and the
// `installments` of PUT /debts/:id take the same list.
const INSTALLMENT_ROWS_SCHEMA = {
  type: 'array',
  maxItems: MAX_INSTALLMENTS,
  items: {
    type: 'object',
    required: ['due_date', 'amount'],
    properties: {
      due_date: { type: 'string', format: 'date' },
      // a JSON number is coerced to its decimal text; parsed exactly later
      amount: { type: 'string', maxLength: 40 }
    }
  }
}

// Why a debt of `amount` cannot hold `schedule` (a splitSchedule /
// normalizeSchedule result), as [status, errors.* key, params]; null when it can.
function scheduleError(schedule, amount, currency) {
  if (!schedule.ok) return [400, schedule.error, schedule.params]
  if (schedule.rows.length && !scheduleMatchesDebt(schedule.rows, amount)) {
    return [422, 'installments_sum_mismatch', {
      sum: scheduleTotal(schedule.rows).toFixed(),
      amount: new Decimal(amount).toFixed(),
      currency
    }]
  }
  return null
}

async function debtRoutes(fastify, opts) {
  // The transaction booked when the debt was created. It is inserted in the
  // same DB transaction as the debt (or later with the debt's created_at), so
  // it shares the debt's created_at — the same pairing rule migration 20 used
  // for transfer legs. The note pins it to this debt's name.
  async function findDebtBooking(client, debtId) {
    const res = await client.query(
      `SELECT t.id, t.account_id, t.user_id, t.amount, t.type, t.is_split, a.currency AS account_currency,
              EXISTS (SELECT 1 FROM attachments x WHERE x.transaction_id = t.id) AS has_attachments
       FROM transactions t
       JOIN debts d ON d.id = $1
       JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id = d.account_id AND t.created_at = d.created_at
         AND t.note = ('debt_created:' || d.name)
       ORDER BY t.id
       LIMIT 1
       FOR UPDATE OF t`,
      [debtId]
    )
    return res.rows[0] || null
  }

  async function bookDebtCreation(client, { debtId, account, amount, debtType, name, userId }) {
    const txType = bookingType(debtType)
    const categoryId = await getDebtCategoryId(client, txType, userId)
    await client.query(
      `INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, (SELECT d.created_at FROM debts d WHERE d.id = $8))`,
      [account.owner_id, account.id, categoryId, amount.toFixed(), txType, `debt_created:${name}`, userId, debtId]
    )
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
      [amount.times(signOf(txType)).toFixed(), account.id, account.owner_id]
    )
  }

  // Rolls back and answers an error; `code` is the errors.* key, stable for
  // clients that branch on it.
  async function abort(client, reply, status, key, lang, params = {}) {
    await client.query('ROLLBACK')
    reply.code(status)
    return { error: t(`errors.${key}`, params, lang), code: key }
  }

  // Runs `work(client)` inside BEGIN … COMMIT on a pooled client. `work`
  // commits by returning normally; it calls abort() to roll back.
  async function inTransaction(work) {
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const out = await work(client)
      if (!out?.aborted) await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // The installment with its debt, the debt locked first (lockDebt) so every
  // writer of one debt — payments, schedule edits — runs one after another.
  async function lockInstallment(client, installmentId, userId) {
    const found = await client.query('SELECT debt_id FROM debt_installments WHERE id = $1', [installmentId])
    const debtId = found.rows[0]?.debt_id
    const debt = debtId ? await lockDebt(client, debtId, userId) : null
    if (!debt || debt.access === 'none') return { status: 404, key: 'installment_not_found' }
    if (debt.access !== 'edit') return { status: 403, key: 'not_allowed' }
    // Re-read under the lock: a concurrent schedule replacement may have removed it.
    const { rows } = await client.query(
      `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments i WHERE i.id = $1 AND i.debt_id = $2 FOR UPDATE OF i`,
      [installmentId, debtId]
    )
    if (!rows[0]) return { status: 404, key: 'installment_not_found' }
    return { debt, installment: rows[0] }
  }

  // An installment action: lock, check, run `act`, commit. `act` returns the
  // response body or { abort: [status, key, params] }.
  async function installmentAction(request, reply, act) {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    let after = null
    const body = await inTransaction(async client => {
      const locked = await lockInstallment(client, request.params.id, userId)
      if (locked.key) return { aborted: true, body: await abort(client, reply, locked.status, locked.key, lang) }
      const out = await act(client, { ...locked, userId })
      if (out.abort) {
        const [status, key, params] = out.abort
        return { aborted: true, body: await abort(client, reply, status, key, lang, params) }
      }
      after = out.after ?? null
      return { body: out.body }
    })
    if (after) await after()
    return body.body
  }

  // How many installments a debt has, and how many are paid or skipped (a
  // schedule with any of those can no longer be replaced).
  async function installmentCounts(client, debtId) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status <> 'due')::int AS settled
       FROM debt_installments WHERE debt_id = $1`,
      [debtId]
    )
    return { total: rows[0]?.total ?? 0, settled: rows[0]?.settled ?? 0 }
  }

  // Replaces a debt's schedule with validated rows (normalizeSchedule /
  // splitSchedule), stored under the debt's owner; [] removes it. Returns the
  // installments as stored.
  async function replaceSchedule(client, debtId, ownerId, rows) {
    await client.query('DELETE FROM debt_installments WHERE debt_id = $1', [debtId])
    if (rows.length === 0) return []
    const inserted = await client.query(
      `INSERT INTO debt_installments (debt_id, user_id, position, due_date, amount)
       SELECT $1, $2, r.position, r.due_date, r.amount
       FROM unnest($3::int[], $4::date[], $5::numeric[]) AS r(position, due_date, amount)
       RETURNING id`,
      [debtId, ownerId, rows.map(r => r.position), rows.map(r => r.due_date), rows.map(r => r.amount)]
    )
    const reread = await client.query(
      `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments i WHERE i.id = ANY($1::int[]) ORDER BY i.position`,
      [inserted.rows.map(r => r.id)]
    )
    return reread.rows
  }

  // List with converted paid_amount and remaining in the debt's currency
  fastify.get('/debts', async (request, reply) => {
    const userId = request.user.userId
    const [visible, rates] = await Promise.all([
      visibleAccountIds(fastify.db, userId),
      loadRates(fastify.db)
    ])
    // The account name is only returned when the caller can see that account:
    // a debt shared with the family does not reveal its owner's account names.
    const debtsResult = await fastify.db.query(`
      SELECT d.*, CASE WHEN a.id = ANY($2) THEN a.name ELSE NULL END as account_name,
             CASE WHEN d.user_id = $1 THEN NULL ELSE ou.login END AS owner_login,
             CASE WHEN d.user_id = $1 THEN EXISTS (SELECT 1 FROM entity_shares es3 WHERE es3.entity_type = 'debt' AND es3.entity_id = d.id AND es3.owner_id = d.user_id) ELSE false END AS is_shared
      FROM debts d
      LEFT JOIN accounts a ON a.id = d.account_id
      JOIN users ou ON ou.id = d.user_id
      WHERE ${DEBT_VISIBLE_SQL}
      ORDER BY d.due_date ASC NULLS LAST
    `, [userId, visible])

    const debts = debtsResult.rows
    if (debts.length === 0) return []

    // Payments and installments are stored under the debt owner, whoever
    // entered them; the debt ids are already limited to what the caller may see.
    const debtIds = debts.map(d => d.id)
    const [paymentsResult, installmentsResult] = await Promise.all([
      fastify.db.query('SELECT p.* FROM debt_payments p WHERE p.debt_id = ANY($1)', [debtIds]),
      fastify.db.query(
        `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments i WHERE i.debt_id = ANY($1) ORDER BY i.debt_id, i.position`,
        [debtIds]
      )
    ])

    const paymentsByDebt = {}
    for (const p of paymentsResult.rows) {
      if (!paymentsByDebt[p.debt_id]) paymentsByDebt[p.debt_id] = []
      paymentsByDebt[p.debt_id].push(p)
    }
    const installmentsByDebt = {}
    for (const { debt_id: debtId, user_id: _owner, ...row } of installmentsResult.rows) {
      if (!installmentsByDebt[debtId]) installmentsByDebt[debtId] = []
      installmentsByDebt[debtId].push(row)
    }

    return debts.map(d => {
      const debtCurrency = d.currency || 'USD'
      const paid = paidInDebtCurrency(paymentsByDebt[d.id] || [], debtCurrency, rates, (p, pCurrency) => {
        fastify.log.warn(`Debt payment conversion failed: ${pCurrency} -> ${debtCurrency} for payment ${p.id}`)
      })
      return {
        ...d,
        paid_amount: paid.toNumber(),
        remaining: new Decimal(d.amount).minus(paid).toNumber(),
        installments: installmentsByDebt[d.id] || []
      }
    })
  })

  // Create
  fastify.post('/debts', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'counterparty', 'amount', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          counterparty: { type: 'string', minLength: 1, maxLength: 200 },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          type: { type: 'string', enum: ['lend', 'borrow'] },
          due_date: { type: 'string', format: 'date' },
          description: { type: 'string', maxLength: 2000 },
          account_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { name, counterparty, amount, currency, type, due_date, description, account_id } = request.body
    const debtCurrency = currency || 'USD'
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const rates = await loadRates(client)

      let account = null
      let txAmount = null
      if (account_id) {
        account = await accountForWrite(client, userId, account_id)
        if (!account) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.account_not_found', {}, lang) }
        }
        txAmount = convertForAccount(amount, debtCurrency, account.currency, rates)
        if (txAmount === null) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.exchange_rate_missing', { from: debtCurrency, to: account.currency }, lang) }
        }
      }

      const result = await client.query(
        'INSERT INTO debts (user_id, name, counterparty, amount, currency, type, due_date, description, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [userId, name, counterparty, amount, debtCurrency, type, due_date, description, account_id]
      )
      const debt = result.rows[0]

      if (account) {
        await bookDebtCreation(client, { debtId: debt.id, account, amount: txAmount, debtType: type, name, userId })
      }

      await client.query('COMMIT')
      reply.code(201)
      return debt
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Update. The amount, currency, type and account were booked on the account
  // when the debt was created: without payments an edit moves that booking
  // along; with payments those fields are settled history (409).
  //
  // The installment schedule is in the debt's amount and currency, so it
  // changes with them, in this transaction: `installments: { rows }` replaces
  // it as PUT /debts/:id/installments does (`rows: []` removes it). A new
  // amount or currency on a debt with a schedule needs one (409
  // installments_need_update); once part of it is paid or skipped, neither the
  // schedule nor the amount/currency can change (409 installments_locked).
  fastify.put('/debts/:id', {
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object',
        required: ['name', 'counterparty', 'amount', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          counterparty: { type: 'string', minLength: 1, maxLength: 200 },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          type: { type: 'string', enum: ['lend', 'borrow'] },
          due_date: { type: 'string', format: 'date' },
          description: { type: 'string', maxLength: 2000 },
          status: { type: 'string', enum: ['active', 'paid'] },
          account_id: { type: ['integer', 'null'] },
          installments: {
            type: 'object',
            required: ['rows'],
            properties: { rows: INSTALLMENT_ROWS_SCHEMA }
          }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { name, counterparty, amount, currency, type, due_date, description, status, account_id, installments } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      // Locked: a concurrent payment must not slip in between the payment
      // check and the rewrite of the booking.
      const oldRes = await client.query(
        'SELECT id, name, amount, currency, type, status, account_id FROM debts WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, userId]
      )
      const old = oldRes.rows[0]
      if (!old) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.debt_not_found', {}, lang) }
      }

      // Optional fields that are NOT NULL in the table keep their stored value.
      const next = {
        amount,
        type,
        currency: currency ?? old.currency,
        account_id: account_id === undefined ? old.account_id : account_id
      }
      const bookingChanged = debtBookingChanged(old, next)

      const schedule = installments ? normalizeSchedule(installments.rows) : null
      if (schedule) {
        const invalid = scheduleError(schedule, amount, next.currency)
        if (invalid) return abort(client, reply, invalid[0], invalid[1], lang, invalid[2])
      }
      const sizeChanged = !new Decimal(old.amount).eq(new Decimal(amount)) || old.currency !== next.currency
      if (schedule || sizeChanged) {
        const counts = await installmentCounts(client, id)
        if (counts.settled > 0) return abort(client, reply, 409, 'installments_locked', lang)
        if (!schedule && counts.total > 0) return abort(client, reply, 409, 'installments_need_update', lang)
      }

      let account = null
      let txAmount = null
      if (bookingChanged) {
        const paymentsRes = await client.query('SELECT 1 FROM debt_payments WHERE debt_id = $1 LIMIT 1', [id])
        if (paymentsRes.rows.length) {
          await client.query('ROLLBACK')
          reply.code(409)
          return { error: t('errors.debt_has_payments', {}, lang) }
        }
        if (next.account_id) {
          account = await accountForWrite(client, userId, next.account_id)
          if (!account) {
            await client.query('ROLLBACK')
            reply.code(404)
            return { error: t('errors.account_not_found', {}, lang) }
          }
          const rates = await loadRates(client)
          txAmount = convertForAccount(amount, next.currency, account.currency, rates)
          if (txAmount === null) {
            await client.query('ROLLBACK')
            reply.code(400)
            return { error: t('errors.exchange_rate_missing', { from: next.currency, to: account.currency }, lang) }
          }
        }
      }

      // Keep the creation booking consistent with the debt. It is looked up
      // before the debt row changes (it is matched by the old account and name).
      const booking = old.account_id && (bookingChanged || name !== old.name)
        ? await findDebtBooking(client, id)
        : null
      if (bookingChanged && booking) {
        // Take the old booking off its account first
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [new Decimal(booking.amount).times(signOf(booking.type)).toFixed(), booking.account_id, booking.user_id]
        )
        if (account) {
          const txType = bookingType(type)
          const categoryId = await getDebtCategoryId(client, txType, userId)
          await client.query(
            'UPDATE transactions SET account_id = $1, user_id = $2, amount = $3, type = $4, category_id = $5, note = $6, updated_at = NOW() WHERE id = $7',
            [account.id, account.owner_id, txAmount.toFixed(), txType, categoryId, `debt_created:${name}`, booking.id]
          )
          await client.query(
            'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
            [txAmount.times(signOf(txType)).toFixed(), account.id, account.owner_id]
          )
        } else {
          await client.query('DELETE FROM transactions WHERE id = $1', [booking.id])
        }
      } else if (bookingChanged && account && !old.account_id) {
        // The debt had no account: book it now, as creation would have.
        await bookDebtCreation(client, { debtId: id, account, amount: txAmount, debtType: type, name, userId })
      } else if (!bookingChanged && booking) {
        // Renamed only: the booking follows the name so it stays findable.
        await client.query('UPDATE transactions SET note = $1, updated_at = NOW() WHERE id = $2', [`debt_created:${name}`, booking.id])
      }
      // A booking edited or removed by hand (not found) is left alone: the
      // ledger is not rebooked behind the user's back.

      // A status the owner sets by hand is theirs: auto_paid (set by payments)
      // only survives while the status stays as it was.
      const result = await client.query(
        'UPDATE debts SET name = $1, counterparty = $2, amount = $3, currency = $4, type = $5, due_date = $6, description = $7, status = COALESCE($8, status), auto_paid = (auto_paid AND COALESCE($8, status) = status), account_id = $9, updated_at = NOW() WHERE id = $10 AND user_id = $11 RETURNING *',
        [name, counterparty, amount, next.currency, type, due_date, description, status ?? null, next.account_id, id, userId]
      )
      const saved = schedule ? await replaceSchedule(client, id, userId, schedule.rows) : null
      await client.query('COMMIT')
      return schedule ? { ...result.rows[0], installments: saved } : result.rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Add payment
  fastify.post('/debts/:id/payments', {
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          note: { type: 'string', maxLength: 1000 },
          account_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { amount, currency, note, account_id } = request.body
    const client = await fastify.db.connect()
    let recorded
    let debt
    try {
      await client.query('BEGIN')
      const rates = await loadRates(client)

      // Shared debts: a family member with edit permission can add payments.
      debt = await lockDebt(client, id, userId)
      if (!debt || debt.access === 'none' || debt.access === 'view') {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.debt_not_found', {}, lang) }
      }

      recorded = await recordDebtPayment(client, {
        debt, userId, amount, currency, note, accountId: account_id, rates, log: fastify.log
      })
      if (recorded.error) {
        await client.query('ROLLBACK')
        reply.code(recorded.error === 'account_not_found' ? 404 : 400)
        return { error: t(`errors.${recorded.error}`, recorded.params, lang) }
      }

      await client.query('COMMIT')
      reply.code(201)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // Notifications (network: push/shoutrrr) run only AFTER the DB transaction
    // has committed — they must never hold the transaction or the pooled client.
    if (recorded.fullyPaid) await notifyDebtPaid(fastify, debt)
    return recorded.payment
  })

  // Get payments
  fastify.get('/debts/:id/payments', {
    schema: { params: ID_PARAMS }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const debtCheck = await fastify.db.query(
      `SELECT d.user_id AS owner_id FROM debts d
       WHERE d.id = $2 AND ${DEBT_VISIBLE_SQL}`,
      [userId, id]
    )
    if (debtCheck.rows.length === 0) {
      const lang = await getUserLang(fastify.db, userId)
      reply.code(404)
      return { error: t('errors.debt_not_found', {}, lang) }
    }
    // Account names only for accounts the caller can see
    const visible = await visibleAccountIds(fastify.db, userId)
    const result = await fastify.db.query(
      'SELECT p.*, CASE WHEN a.id = ANY($2) THEN a.name ELSE NULL END as account_name FROM debt_payments p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.debt_id = $1 ORDER BY p.created_at DESC',
      [id, visible]
    )
    return result.rows
  })

  // Delete. Only the owner deletes, and only the owner's share rows go with
  // the debt — after the owned DELETE succeeded, in one transaction.
  //
  // The money the debt moved goes with it: the creation booking and the
  // payment transactions are deleted and their balance effect reversed. A
  // transaction the user changed by hand (or attached a receipt to), or one on
  // an account the caller may not write, is left as it is and reported in
  // kept_transactions. A booked payment whose transaction cannot be found any
  // more (deleted or moved by hand, legacy rows) reverses nothing and is
  // reported in unmatched_payments, so the client can say so.
  fastify.delete('/debts/:id', {
    schema: { params: ID_PARAMS }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const reversed = []
    const kept = []
    const unmatched = []
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      // Locked: no payment may be added between the lookup and the delete.
      const debtRes = await client.query(
        'SELECT id, name, amount, currency, type, account_id FROM debts WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, userId]
      )
      const debt = debtRes.rows[0]
      if (!debt) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.debt_not_found', {}, lang) }
      }

      const candidates = []
      const booking = debt.account_id ? await findDebtBooking(client, id) : null
      if (booking) candidates.push({ tx: booking, untouched: !bookingEditedByHand(booking, debt) })
      const paymentsRes = await client.query(
        'SELECT id, amount::text AS amount, currency FROM debt_payments WHERE debt_id = $1 AND account_id IS NOT NULL ORDER BY id',
        [id]
      )
      const paymentTxs = await findPaymentTransactions(client, paymentsRes.rows.map(p => p.id))
      for (const tx of paymentTxs.values()) candidates.push({ tx, untouched: tx.untouched })
      for (const p of paymentsRes.rows) {
        if (!paymentTxs.has(p.id)) unmatched.push({ id: p.id, amount: p.amount, currency: p.currency })
      }

      for (const { tx, untouched } of candidates) {
        if (untouched && (await canModifyTransaction(client, userId, tx))) {
          await reverseTransaction(client, tx)
          reversed.push(tx.id)
        } else {
          kept.push(tx.id)
        }
      }

      await client.query('DELETE FROM debts WHERE id = $1 AND user_id = $2', [id, userId])
      await client.query(
        "DELETE FROM entity_shares WHERE entity_type = 'debt' AND entity_id = $1 AND owner_id = $2",
        [id, userId]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    if (kept.length || unmatched.length) {
      request.log.info(
        { debtId: id, keptTransactions: kept, unmatchedPayments: unmatched.map(p => p.id) },
        'Debt deleted; transactions edited by hand or not writable were kept, payments without a transaction reversed nothing'
      )
    }
    return { success: true, reversed_transactions: reversed, kept_transactions: kept, unmatched_payments: unmatched }
  })

  // ---------------------------------------------------------------------------
  // Installment schedule. Writes need edit access to the debt (owner or an
  // 'edit' share); a 'view' share sees the schedule in GET /debts only.

  // Replace the whole schedule: hand-entered `rows`, or `split` into equal
  // parts at the currency's precision. Only while every installment is still
  // due; the rows must add up to the debt amount exactly. `rows: []` removes
  // the schedule.
  fastify.put('/debts/:id/installments', {
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object',
        properties: {
          rows: INSTALLMENT_ROWS_SCHEMA,
          split: {
            type: 'object',
            required: ['count', 'start_date'],
            properties: {
              count: { type: 'integer', minimum: 1, maximum: MAX_INSTALLMENTS },
              start_date: { type: 'string', format: 'date' },
              unit: { type: 'string', enum: ['day', 'week', 'month'] },
              value: { type: 'integer', minimum: 1, maximum: 366 }
            }
          }
        },
        oneOf: [{ required: ['rows'] }, { required: ['split'] }]
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { rows, split } = request.body
    const out = await inTransaction(async client => {
      const debt = await lockDebt(client, id, userId)
      if (!debt || debt.access === 'none') return { aborted: true, body: await abort(client, reply, 404, 'debt_not_found', lang) }
      if (debt.access !== 'edit') return { aborted: true, body: await abort(client, reply, 403, 'not_allowed', lang) }

      const schedule = split
        ? splitSchedule(debt.amount, split.count, split.start_date, { unit: split.unit, value: split.value }, currencyDigits(debt.currency))
        : normalizeSchedule(rows)
      const invalid = scheduleError(schedule, debt.amount, debt.currency)
      if (invalid) return { aborted: true, body: await abort(client, reply, invalid[0], invalid[1], lang, invalid[2]) }
      if ((await installmentCounts(client, id)).settled > 0) {
        return { aborted: true, body: await abort(client, reply, 409, 'installments_locked', lang) }
      }

      const installments = await replaceSchedule(client, id, debt.owner_id, schedule.rows)
      return { body: { debt_id: id, installments } }
    })
    return out.body
  })

  // Pay one installment: records a debt payment of the installment amount
  // (in `currency` when given, converted from the debt's currency) and books
  // it on `account_id` — the debt's own account when omitted, none when null.
  fastify.post('/debts/installments/:id/pay', {
    schema: {
      params: ID_PARAMS,
      body: {
        type: ['object', 'null'],
        properties: {
          account_id: { type: ['integer', 'null'] },
          currency: { type: 'string', maxLength: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body ?? {}
    return installmentAction(request, reply, async (client, { debt, installment, userId }) => {
      if (installment.status === 'paid') return { abort: [409, 'already_paid'] }
      const rates = await loadRates(client)
      const debtCurrency = debt.currency || 'USD'
      const paymentCurrency = body.currency || debtCurrency
      const amount = convertAmountDecimal(installment.amount, debtCurrency, paymentCurrency, rates)
      if (amount === null) return { abort: [400, 'exchange_rate_missing', { from: debtCurrency, to: paymentCurrency }] }

      const recorded = await recordDebtPayment(client, {
        debt,
        userId,
        amount,
        currency: paymentCurrency,
        note: installment.note,
        accountId: body.account_id === undefined ? debt.account_id : body.account_id,
        installmentId: installment.id,
        rates,
        log: fastify.log
      })
      if (recorded.error) {
        return { abort: [recorded.error === 'account_not_found' ? 404 : 400, recorded.error, recorded.params] }
      }
      const { rows } = await client.query(
        `UPDATE debt_installments i SET status = 'paid', paid_on = CURRENT_DATE, updated_at = now()
         WHERE i.id = $1 RETURNING ${INSTALLMENT_COLUMNS}`,
        [installment.id]
      )
      reply.code(201)
      return {
        body: { installment: rows[0], payment: recorded.payment, transaction: recorded.transaction },
        after: recorded.fullyPaid ? () => notifyDebtPaid(fastify, debt) : null
      }
    })
  })

  // Undo an installment payment: its payments go, and so do their
  // transactions with their balance effect — but only while every one of
  // those transactions is as the payment booked it (409 payment_edited). A
  // payment whose transaction no longer exists (deleted or moved to another
  // account by hand) has nothing left to reverse: the payment row just goes.
  fastify.delete('/debts/installments/:id/pay', {
    schema: { params: ID_PARAMS }
  }, async (request, reply) => {
    return installmentAction(request, reply, async (client, { debt, installment, userId }) => {
      if (installment.status !== 'paid') return { abort: [409, 'installment_not_paid'] }
      const paymentsRes = await client.query(
        'SELECT id, account_id FROM debt_payments WHERE debt_id = $1 AND installment_id = $2 ORDER BY id FOR UPDATE',
        [debt.id, installment.id]
      )
      const payments = paymentsRes.rows
      const booked = payments.filter(p => p.account_id !== null && p.account_id !== undefined)
      const txs = await findPaymentTransactions(client, booked.map(p => p.id))
      for (const tx of txs.values()) {
        if (!tx.untouched) return { abort: [409, 'payment_edited'] }
        if (!(await canModifyTransaction(client, userId, tx))) return { abort: [403, 'not_allowed'] }
      }

      const reversedIds = []
      for (const tx of txs.values()) {
        await reverseTransaction(client, tx)
        reversedIds.push(tx.id)
      }
      const paymentIds = payments.map(p => p.id)
      if (paymentIds.length) {
        await client.query('DELETE FROM debt_payments WHERE id = ANY($1::int[])', [paymentIds])
      }
      const { rows } = await client.query(
        `UPDATE debt_installments i SET status = 'due', paid_on = NULL, updated_at = now()
         WHERE i.id = $1 RETURNING ${INSTALLMENT_COLUMNS}`,
        [installment.id]
      )

      // The automatic 'paid' status follows the payments back; one the owner
      // set by hand (auto_paid false) stays.
      if (debt.status === 'paid' && debt.auto_paid) {
        const rates = await loadRates(client)
        const left = await client.query('SELECT amount, currency FROM debt_payments WHERE debt_id = $1', [debt.id])
        const paid = paidInDebtCurrency(left.rows, debt.currency || 'USD', rates)
        if (!debtCovered(paid, debt.amount, debt.currency)) {
          await client.query("UPDATE debts SET status = 'active', auto_paid = false, updated_at = NOW() WHERE id = $1", [debt.id])
        }
      }
      return { body: { installment: rows[0], removed_payments: paymentIds, reversed_transactions: reversedIds } }
    })
  })

  // Skip / un-skip: the status only, no money moves.
  async function setSkipped(request, reply, skipped) {
    return installmentAction(request, reply, async (client, { installment }) => {
      if (installment.status === 'paid') return { abort: [409, 'already_paid'] }
      const { rows } = await client.query(
        `UPDATE debt_installments i SET status = $1, updated_at = now()
         WHERE i.id = $2 RETURNING ${INSTALLMENT_COLUMNS}`,
        [skipped ? 'skipped' : 'due', installment.id]
      )
      return { body: { installment: rows[0] } }
    })
  }

  fastify.post('/debts/installments/:id/skip', { schema: { params: ID_PARAMS } }, (request, reply) =>
    setSkipped(request, reply, true))
  fastify.delete('/debts/installments/:id/skip', { schema: { params: ID_PARAMS } }, (request, reply) =>
    setSkipped(request, reply, false))

  // Edit one due installment. A new amount must keep the schedule's sum equal
  // to the debt amount (422); a new date re-sorts the positions.
  fastify.patch('/debts/installments/:id', {
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          due_date: { type: 'string', format: 'date' },
          amount: { type: 'string', maxLength: 40 },
          note: { type: ['string', 'null'], maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const { due_date: dueDate, amount: rawAmount, note } = request.body
    try {
      return await installmentAction(request, reply, async (client, { debt, installment }) => {
        if (installment.status !== 'due') return { abort: [409, 'installment_not_due'] }
        const sets = []
        const values = []
        if (dueDate !== undefined) {
          values.push(dueDate)
          sets.push(`due_date = $${values.length}::date`)
        }
        if (rawAmount !== undefined) {
          const amount = parseInstallmentAmount(rawAmount)
          if (!amount) return { abort: [400, 'installments_invalid'] }
          const others = await client.query(
            'SELECT amount FROM debt_installments WHERE debt_id = $1 AND id <> $2',
            [debt.id, installment.id]
          )
          const rows = [...others.rows, { amount: amount.toFixed() }]
          if (!scheduleMatchesDebt(rows, debt.amount)) {
            return {
              abort: [422, 'installments_sum_mismatch', {
                sum: scheduleTotal(rows).toFixed(),
                amount: new Decimal(debt.amount).toFixed(),
                currency: debt.currency
              }]
            }
          }
          values.push(amount.toFixed())
          sets.push(`amount = $${values.length}`)
        }
        if (note !== undefined) {
          values.push(note)
          sets.push(`note = $${values.length}`)
        }
        if (sets.length === 0) return { abort: [400, 'no_fields_to_update'] }
        values.push(installment.id)
        await client.query(
          `UPDATE debt_installments SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
          values
        )
        if (dueDate !== undefined && dueDate !== installment.due_date) {
          // Positions follow the dates. Two steps: UNIQUE (debt_id, position)
          // is checked row by row, so the old numbers are moved out of the way first.
          await client.query('UPDATE debt_installments SET position = -position WHERE debt_id = $1', [debt.id])
          await client.query(
            `UPDATE debt_installments i SET position = r.rn
             FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY due_date, id) AS rn FROM debt_installments WHERE debt_id = $1) r
             WHERE i.id = r.id`,
            [debt.id]
          )
        }
        const { rows } = await client.query(
          `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments i WHERE i.id = $1`,
          [installment.id]
        )
        return { body: { installment: rows[0] } }
      })
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'debt_installments_debt_id_due_date_key') {
        const lang = await getUserLang(fastify.db, request.user.userId)
        reply.code(409)
        return { error: t('errors.installment_date_taken', { date: dueDate }, lang), code: 'installment_date_taken' }
      }
      throw err
    }
  })
}

export default debtRoutes
