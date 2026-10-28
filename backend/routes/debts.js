import { t, getUserLang } from '../services/i18n.js'
import Decimal from 'decimal.js'
import { loadRates, convertAmountDecimal } from '../services/currency.js'
import { accountForWrite, visibleAccountIds } from '../services/visibility.js'
import { notify } from '../services/notify.js'
import { paidInDebtCurrency } from '../services/debt-payments.js'

// A debt shared both to the whole family and to the user directly has two
// share rows; visibility is an EXISTS so the debt is listed once.
const DEBT_VISIBLE_SQL = `(d.user_id = $1 OR EXISTS (
  SELECT 1 FROM entity_shares es
  WHERE es.entity_type = 'debt' AND es.entity_id = d.id AND es.owner_id = d.user_id
    AND (es.shared_with = $1 OR es.shared_with IS NULL)
))`

// Amount of a debt booking in the target account's currency, exact. null when
// no rate links the two currencies — the caller answers 400 instead of booking
// the raw number in the wrong currency (100 USD must never become 100 BTC).
export function convertForAccount(amount, fromCurrency, accountCurrency, rates) {
  if (!fromCurrency || !accountCurrency || fromCurrency === accountCurrency) return new Decimal(amount)
  return convertAmountDecimal(amount, fromCurrency, accountCurrency, rates)
}

// Fields that are booked on the account when a debt is created: once payments
// exist they are settled history and cannot be rewritten by an edit.
export function debtBookingChanged(old, next) {
  return !new Decimal(old.amount).eq(new Decimal(next.amount)) ||
    old.currency !== next.currency ||
    old.type !== next.type ||
    (old.account_id ?? null) !== (next.account_id ?? null)
}

const bookingType = debtType => (debtType === 'borrow' ? 'income' : 'expense')
const signOf = txType => (txType === 'income' ? 1 : -1)

async function debtRoutes(fastify, opts) {
  async function getDebtCategoryId(client, txType, userId) {
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

  // The transaction booked when the debt was created. It is inserted in the
  // same DB transaction as the debt (or later with the debt's created_at), so
  // it shares the debt's created_at — the same pairing rule migration 20 used
  // for transfer legs. The note pins it to this debt's name.
  async function findDebtBooking(client, debtId) {
    const res = await client.query(
      `SELECT t.id, t.account_id, t.user_id, t.amount, t.type
       FROM transactions t
       JOIN debts d ON d.id = $1
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

    // Payments are stored under the debt owner, whoever entered them; the
    // debt ids are already limited to what the caller may see.
    const debtIds = debts.map(d => d.id)
    const paymentsResult = await fastify.db.query(
      'SELECT p.* FROM debt_payments p WHERE p.debt_id = ANY($1)',
      [debtIds]
    )

    const paymentsByDebt = {}
    for (const p of paymentsResult.rows) {
      if (!paymentsByDebt[p.debt_id]) paymentsByDebt[p.debt_id] = []
      paymentsByDebt[p.debt_id].push(p)
    }

    return debts.map(d => {
      const debtCurrency = d.currency || 'USD'
      const paid = paidInDebtCurrency(paymentsByDebt[d.id] || [], debtCurrency, rates, (p, pCurrency) => {
        fastify.log.warn(`Debt payment conversion failed: ${pCurrency} -> ${debtCurrency} for payment ${p.id}`)
      })
      return {
        ...d,
        paid_amount: paid.toNumber(),
        remaining: new Decimal(d.amount).minus(paid).toNumber()
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
  fastify.put('/debts/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
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
          account_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { name, counterparty, amount, currency, type, due_date, description, status, account_id } = request.body
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

      const result = await client.query(
        'UPDATE debts SET name = $1, counterparty = $2, amount = $3, currency = $4, type = $5, due_date = $6, description = $7, status = COALESCE($8, status), account_id = $9, updated_at = NOW() WHERE id = $10 AND user_id = $11 RETURNING *',
        [name, counterparty, amount, next.currency, type, due_date, description, status ?? null, next.account_id, id, userId]
      )
      await client.query('COMMIT')
      return result.rows[0]
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
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
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
    let debtFullyPaid = null
    let created = null
    let debtOwner = null
    try {
      await client.query('BEGIN')
      const rates = await loadRates(client)

      // Shared debts: a family member with edit permission can add payments.
      // The debt row is locked so concurrent payments are summed one after
      // another and the automatic 'paid' status sees every payment.
      const debtRes = await client.query(
        `SELECT d.id, d.amount, d.currency, d.type, d.name, d.user_id AS owner_id,
                CASE WHEN d.user_id = $2 THEN 'edit' ELSE COALESCE((SELECT es.permission FROM entity_shares es
                  WHERE es.entity_type = 'debt' AND es.entity_id = d.id AND es.owner_id = d.user_id
                    AND (es.shared_with = $2 OR es.shared_with IS NULL)
                  ORDER BY (es.permission = 'edit') DESC LIMIT 1), 'none') END AS access
         FROM debts d WHERE d.id = $1
         FOR UPDATE OF d`,
        [id, userId]
      )
      const debt = debtRes.rows[0]
      if (!debt || debt.access === 'none' || debt.access === 'view') {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.debt_not_found', {}, lang) }
      }
      debtOwner = debt.owner_id
      const debtCurrency = debt.currency || 'USD'
      const paymentCurrency = currency || debtCurrency

      let account = null
      let txAmount = null
      if (account_id) {
        account = await accountForWrite(client, userId, account_id)
        if (!account) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.account_not_found', {}, lang) }
        }
        txAmount = convertForAccount(amount, paymentCurrency, account.currency, rates)
        if (txAmount === null) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.exchange_rate_missing', { from: paymentCurrency, to: account.currency }, lang) }
        }
      }

      const result = await client.query(
        'INSERT INTO debt_payments (user_id, debt_id, amount, currency, note, account_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [debtOwner, id, amount, paymentCurrency, note, account_id, userId]
      )

      if (account) {
        const txType = debt.type === 'borrow' ? 'expense' : 'income'
        const categoryId = await getDebtCategoryId(client, txType, userId)

        await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, created_by) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7)',
          [account.owner_id, account.id, categoryId, txAmount.toFixed(), txType, `debt_payment:${debt.name}`, userId]
        )
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [txAmount.times(signOf(txType)).toFixed(), account.id, account.owner_id]
        )
      }

      const paymentsRes = await client.query('SELECT amount, currency FROM debt_payments WHERE debt_id = $1', [id])
      const paid = paidInDebtCurrency(paymentsRes.rows, debtCurrency, rates, (p, pCurrency) => {
        fastify.log.warn(`Debt payment conversion failed on full-paid check: ${pCurrency} -> ${debtCurrency}`)
      })
      if (paid.gte(new Decimal(debt.amount))) {
        await client.query('UPDATE debts SET status = $1 WHERE id = $2', ['paid', id])
        debtFullyPaid = debt
      }

      await client.query('COMMIT')
      reply.code(201)
      created = result.rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // Notifications (network: push/shoutrrr) run only AFTER the DB transaction
    // has committed — they must never hold the transaction or the pooled client.
    if (debtFullyPaid) {
      try {
        const lang = await getUserLang(fastify.db, debtOwner)
        const title = t('notifications.debt_paid', {}, lang)
        const message = t('notifications.debt_paid_body', { name: debtFullyPaid.name }, lang)
        await notify(fastify, debtOwner || userId, {
          type: 'debt_paid', title, message,
          data: { entity_id: id, url: '/debts' },
          channels: ['bell', 'push', 'shoutrrr']
        })
      } catch (notifErr) {
        fastify.log.warn(notifErr, 'Debt paid notification failed')
      }
    }
    return created
  })

  // Get payments
  fastify.get('/debts/:id/payments', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
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
  fastify.delete('/debts/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query('DELETE FROM debts WHERE id = $1 AND user_id = $2', [id, userId])
      if (result.rowCount === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.debt_not_found', {}, lang) }
      }
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
    reply.code(204)
  })
}

export default debtRoutes
