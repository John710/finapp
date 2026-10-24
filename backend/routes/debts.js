import { t, getUserLang } from '../services/i18n.js'
import Decimal from 'decimal.js'
import { loadRates, convertAmount, convertAmountDecimal } from '../services/currency.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'

async function debtRoutes(fastify, opts) {
  async function getDebtCategoryId(client, txType, userId) {
    const lang = await getUserLang(client, userId)
    const catName = t('debts.title', {}, lang)
    // 'Title' is the fallback name persisted before the debts.title locale key
    // existed — treat it as legacy so those categories are reused, not duplicated.
    const legacyNames = txType === 'income'
      ? ['Debts (income)', 'Долги (доход)', 'Title']
      : ['Debts (expense)', 'Долги (расход)', 'Title']
    let res = await client.query('SELECT id FROM categories WHERE name = $1 AND type = $2 AND user_id = $3', [catName, txType, userId])
    if (res.rows.length) return res.rows[0].id
    for (const name of legacyNames) {
      res = await client.query('SELECT id FROM categories WHERE name = $1 AND type = $2 AND user_id = $3', [name, txType, userId])
      if (res.rows.length) return res.rows[0].id
    }
    const newRes = await client.query(
      'INSERT INTO categories (user_id, name, type, color, icon) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, catName, txType, '#64748b', 'tag']
    )
    return newRes.rows[0].id
  }

  async function convertForAccount(client, amount, fromCurrency, accountId, rates, userId) {
    if (!accountId || !fromCurrency) return amount
    const accRes = await client.query('SELECT currency FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId])
    const toCurrency = accRes.rows[0]?.currency
    if (!toCurrency || fromCurrency === toCurrency) return amount
    const converted = convertAmount(amount, fromCurrency, toCurrency, rates)
    if (converted === null) {
      fastify.log.warn(`Debt transaction conversion failed: ${fromCurrency} -> ${toCurrency} for account ${accountId}`)
      return amount
    }
    return converted
  }

  // List with converted paid_amount and remaining in the debt's currency
  fastify.get('/debts', async (request, reply) => {
    const userId = request.user.userId
    const [debtsResult, rates] = await Promise.all([
      fastify.db.query(`
        SELECT d.*, a.name as account_name
        FROM debts d
        LEFT JOIN accounts a ON a.id = d.account_id AND a.user_id = $1
        WHERE d.user_id = $1
        ORDER BY d.due_date ASC NULLS LAST
      `, [userId]),
      loadRates(fastify.db)
    ])

    const debts = debtsResult.rows
    if (debts.length === 0) return []

    const debtIds = debts.map(d => d.id)
    const paymentsResult = await fastify.db.query(
      'SELECT p.* FROM debt_payments p WHERE p.debt_id = ANY($1) AND p.user_id = $2',
      [debtIds, userId]
    )

    const paymentsByDebt = {}
    for (const p of paymentsResult.rows) {
      if (!paymentsByDebt[p.debt_id]) paymentsByDebt[p.debt_id] = []
      paymentsByDebt[p.debt_id].push(p)
    }

    return debts.map(d => {
      const debtCurrency = d.currency || 'USD'
      const payments = paymentsByDebt[d.id] || []
      let paid = new Decimal(0)
      for (const p of payments) {
        const pCurrency = p.currency || debtCurrency
        if (pCurrency === debtCurrency) {
          paid = paid.plus(new Decimal(p.amount))
        } else {
          const converted = convertAmountDecimal(p.amount, pCurrency, debtCurrency, rates)
          if (converted === null) {
            fastify.log.warn(`Debt payment conversion failed: ${pCurrency} -> ${debtCurrency} for payment ${p.id}`)
            paid = paid.plus(new Decimal(p.amount))
          } else {
            paid = paid.plus(converted)
          }
        }
      }
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

      if (account_id) {
        const accRes = await client.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
        if (accRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.account_not_found', {}, lang) }
        }
      }

      const result = await client.query(
        'INSERT INTO debts (user_id, name, counterparty, amount, currency, type, due_date, description, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [userId, name, counterparty, amount, debtCurrency, type, due_date, description, account_id]
      )
      const debt = result.rows[0]

      if (account_id) {
        const txType = type === 'borrow' ? 'income' : 'expense'
        const sign = txType === 'income' ? 1 : -1
        const categoryId = await getDebtCategoryId(client, txType, userId)
        const txAmount = await convertForAccount(client, amount, debtCurrency, account_id, rates, userId)

        await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6)',
          [userId, account_id, categoryId, txAmount, txType, `debt_created:${name}`]
        )
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [txAmount * sign, account_id, userId]
        )
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

  // Update
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
    if (account_id) {
      const accRes = await fastify.db.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
      if (accRes.rows.length === 0) {
        reply.code(404)
        return { error: t('errors.account_not_found', {}, lang) }
      }
    }
    const result = await fastify.db.query(
      'UPDATE debts SET name = $1, counterparty = $2, amount = $3, currency = $4, type = $5, due_date = $6, description = $7, status = $8, account_id = $9, updated_at = NOW() WHERE id = $10 AND user_id = $11 RETURNING *',
      [name, counterparty, amount, currency, type, due_date, description, status, account_id, id, userId]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: t('errors.debt_not_found', {}, lang) }
    }
    return result.rows[0]
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
    try {
      await client.query('BEGIN')
      const rates = await loadRates(client)

      const debtRes = await client.query('SELECT amount, currency, type, name FROM debts WHERE id = $1 AND user_id = $2', [id, userId])
      const debt = debtRes.rows[0]
      if (!debt) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.debt_not_found', {}, lang) }
      }
      const debtCurrency = debt.currency || 'USD'
      const paymentCurrency = currency || debtCurrency

      if (account_id) {
        const accRes = await client.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
        if (accRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.account_not_found', {}, lang) }
        }
      }

      const result = await client.query(
        'INSERT INTO debt_payments (user_id, debt_id, amount, currency, note, account_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [userId, id, amount, paymentCurrency, note, account_id]
      )

      if (account_id) {
        const txType = debt.type === 'borrow' ? 'expense' : 'income'
        const sign = txType === 'income' ? 1 : -1
        const categoryId = await getDebtCategoryId(client, txType, userId)
        const txAmount = await convertForAccount(client, amount, paymentCurrency, account_id, rates, userId)

        await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6)',
          [userId, account_id, categoryId, txAmount, txType, `debt_payment:${debt.name}`]
        )
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [txAmount * sign, account_id, userId]
        )
      }

      const paymentsRes = await client.query('SELECT amount, currency FROM debt_payments WHERE debt_id = $1 AND user_id = $2', [id, userId])
      let paid = new Decimal(0)
      for (const p of paymentsRes.rows) {
        const pCurrency = p.currency || debtCurrency
        if (pCurrency === debtCurrency) {
          paid = paid.plus(new Decimal(p.amount))
        } else {
          const converted = convertAmountDecimal(p.amount, pCurrency, debtCurrency, rates)
          if (converted === null) {
            fastify.log.warn(`Debt payment conversion failed on full-paid check: ${pCurrency} -> ${debtCurrency}`)
            paid = paid.plus(new Decimal(p.amount))
          } else {
            paid = paid.plus(converted)
          }
        }
      }
      if (paid.gte(new Decimal(debt.amount))) {
        await client.query('UPDATE debts SET status = $1 WHERE id = $2 AND user_id = $3', ['paid', id, userId])
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
        const lang = await getUserLang(fastify.db, userId)
        const title = t('notifications.debt_paid', {}, lang)
        const message = t('notifications.debt_paid_body', { name: debtFullyPaid.name }, lang)
        await notify(fastify, userId, {
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
    const result = await fastify.db.query(
      'SELECT p.*, a.name as account_name FROM debt_payments p LEFT JOIN accounts a ON a.id = p.account_id AND a.user_id = $1 WHERE p.debt_id = $2 AND p.user_id = $1 ORDER BY p.created_at DESC',
      [userId, id]
    )
    return result.rows
  })

  // Delete
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
    const result = await fastify.db.query('DELETE FROM debts WHERE id = $1 AND user_id = $2', [id, userId])
    if (result.rowCount === 0) {
      reply.code(404)
      return { error: t('errors.debt_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default debtRoutes
