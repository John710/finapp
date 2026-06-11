import { t, getUserLang } from '../services/i18n.js'
import { loadRates, convertAmount } from '../services/currency.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'

async function debtRoutes(fastify, opts) {
  async function getDebtCategoryId(client, txType) {
    const lang = await getUserLang(client)
    const catName = t('debts.title', {}, lang)
    const legacyNames = txType === 'income'
      ? ['Debts (income)', 'Долги (доход)']
      : ['Debts (expense)', 'Долги (расход)']
    // Try translated name first
    let res = await client.query('SELECT id FROM categories WHERE name = $1 AND type = $2', [catName, txType])
    if (res.rows.length) return res.rows[0].id
    // Fallback to legacy names
    for (const name of legacyNames) {
      res = await client.query('SELECT id FROM categories WHERE name = $1 AND type = $2', [name, txType])
      if (res.rows.length) return res.rows[0].id
    }
    // Create new category if none found
    const newRes = await client.query(
      'INSERT INTO categories (name, type, color, icon) VALUES ($1, $2, $3, $4) RETURNING id',
      [catName, txType, '#64748b', 'tag']
    )
    return newRes.rows[0].id
  }

  async function convertForAccount(client, amount, fromCurrency, accountId, rates) {
    if (!accountId || !fromCurrency) return amount
    const accRes = await client.query('SELECT currency FROM accounts WHERE id = $1', [accountId])
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
    const [debtsResult, rates] = await Promise.all([
      fastify.db.query(`
        SELECT d.*, a.name as account_name
        FROM debts d
        LEFT JOIN accounts a ON a.id = d.account_id
        ORDER BY d.due_date ASC NULLS LAST
      `),
      loadRates(fastify.db)
    ])

    const debts = debtsResult.rows
    if (debts.length === 0) return []

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
      const amount = parseFloat(d.amount)
      const payments = paymentsByDebt[d.id] || []
      let paid = 0
      for (const p of payments) {
        const pAmount = parseFloat(p.amount)
        const pCurrency = p.currency || debtCurrency
        if (pCurrency === debtCurrency) {
          paid += pAmount
        } else {
          const converted = convertAmount(pAmount, pCurrency, debtCurrency, rates)
          if (converted === null) {
            fastify.log.warn(`Debt payment conversion failed: ${pCurrency} -> ${debtCurrency} for payment ${p.id}`)
            paid += pAmount
          } else {
            paid += converted
          }
        }
      }
      return {
        ...d,
        paid_amount: paid,
        remaining: amount - paid
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
          name: { type: 'string', minLength: 1 },
          counterparty: { type: 'string', minLength: 1 },
          amount: { type: 'number', minimum: 0 },
          currency: { type: 'string' },
          type: { type: 'string', enum: ['lend', 'borrow'] },
          due_date: { type: 'string' },
          description: { type: 'string' },
          account_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const { name, counterparty, amount, currency, type, due_date, description, account_id } = request.body
    const debtCurrency = currency || 'USD'
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const rates = await loadRates(client)

      const result = await client.query(
        'INSERT INTO debts (name, counterparty, amount, currency, type, due_date, description, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [name, counterparty, amount, debtCurrency, type, due_date, description, account_id]
      )
      const debt = result.rows[0]

      // Create initial transaction when debt is linked to an account
      if (account_id) {
        const txType = type === 'borrow' ? 'income' : 'expense'
        const sign = txType === 'income' ? 1 : -1
        const categoryId = await getDebtCategoryId(client, txType)
        const txAmount = await convertForAccount(client, amount, debtCurrency, account_id, rates)

        await client.query(
          'INSERT INTO transactions (account_id, category_id, amount, type, date, note) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)',
          [account_id, categoryId, txAmount, txType, `debt_created:${name}`]
        )
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
          [txAmount * sign, account_id]
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
  fastify.put('/debts/:id', async (request, reply) => {
    const { id } = request.params
    const { name, counterparty, amount, currency, type, due_date, description, status, account_id } = request.body
    const result = await fastify.db.query(
      'UPDATE debts SET name = $1, counterparty = $2, amount = $3, currency = $4, type = $5, due_date = $6, description = $7, status = $8, account_id = $9, updated_at = NOW() WHERE id = $10 RETURNING *',
      [name, counterparty, amount, currency, type, due_date, description, status, account_id, id]
    )
    if (result.rows.length === 0) {
      reply.code(404)
      return { error: 'Debt not found' }
    }
    return result.rows[0]
  })

  // Add payment
  fastify.post('/debts/:id/payments', {
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: 0 },
          currency: { type: 'string' },
          note: { type: 'string' },
          account_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { amount, currency, note, account_id } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const rates = await loadRates(client)

      const debtRes = await client.query('SELECT amount, currency, type, name FROM debts WHERE id = $1', [id])
      const debt = debtRes.rows[0]
      if (!debt) {
        reply.code(404)
        return { error: 'Debt not found' }
      }
      const debtCurrency = debt.currency || 'USD'
      const paymentCurrency = currency || debtCurrency

      const result = await client.query(
        'INSERT INTO debt_payments (debt_id, amount, currency, note, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [id, amount, paymentCurrency, note, account_id]
      )

      // Create corresponding transaction and update balance
      if (account_id) {
        const txType = debt.type === 'borrow' ? 'expense' : 'income'
        const sign = txType === 'income' ? 1 : -1
        const categoryId = await getDebtCategoryId(client, txType)
        const txAmount = await convertForAccount(client, amount, paymentCurrency, account_id, rates)

        await client.query(
          'INSERT INTO transactions (account_id, category_id, amount, type, date, note) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)',
          [account_id, categoryId, txAmount, txType, `debt_payment:${debt.name}`]
        )
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
          [txAmount * sign, account_id]
        )
      }

      // Check if fully paid — convert all payments to debt currency
      const paymentsRes = await client.query('SELECT amount, currency FROM debt_payments WHERE debt_id = $1', [id])
      let paid = 0
      for (const p of paymentsRes.rows) {
        const pAmount = parseFloat(p.amount)
        const pCurrency = p.currency || debtCurrency
        if (pCurrency === debtCurrency) {
          paid += pAmount
        } else {
          const converted = convertAmount(pAmount, pCurrency, debtCurrency, rates)
          if (converted === null) {
            fastify.log.warn(`Debt payment conversion failed on full-paid check: ${pCurrency} -> ${debtCurrency}`)
            paid += pAmount
          } else {
            paid += converted
          }
        }
      }
      if (paid >= parseFloat(debt.amount)) {
        await client.query('UPDATE debts SET status = $1 WHERE id = $2', ['paid', id])
        // Notify debt paid off
        try {
          const lang = await getUserLang(fastify.db)
          const userId = request.user.userId
          const title = t('notifications.debt_paid', {}, lang)
          const message = t('notifications.debt_paid_body', { name: debt.name }, lang)
          await notify(fastify, userId, {
            type: 'debt_paid', title, message,
            data: { entity_id: id, url: '/debts' },
            channels: ['bell', 'push', 'shoutrrr']
          })
        } catch (notifErr) {
          fastify.log.warn(notifErr, 'Debt paid notification failed')
        }
      }

      await client.query('COMMIT')
      reply.code(201)
      return result.rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Get payments
  fastify.get('/debts/:id/payments', async (request, reply) => {
    const { id } = request.params
    const result = await fastify.db.query(
      'SELECT p.*, a.name as account_name FROM debt_payments p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.debt_id = $1 ORDER BY p.created_at DESC',
      [id]
    )
    return result.rows
  })

  // Delete
  fastify.delete('/debts/:id', async (request, reply) => {
    const { id } = request.params
    await fastify.db.query('DELETE FROM debts WHERE id = $1', [id])
    reply.code(204)
  })
}

export default debtRoutes
