import { t, getUserLang } from '../services/i18n.js'
import { loadRates, convertAmount } from '../services/currency.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'

async function transactionRoutes(fastify, opts) {
  // List with filters
  fastify.get('/transactions', async (request, reply) => {
    const userId = request.user.userId
    const { account_id, category_id, type, from, to, search, tag_id, limit = 50, offset = 0 } = request.query
    let where = ['t.user_id = $1']
    let params = [userId]
    let idx = 2

    if (account_id) { where.push(`t.account_id = $${idx++}`); params.push(account_id) }
    if (category_id) { where.push(`t.category_id = $${idx++}`); params.push(category_id) }
    if (type) { where.push(`t.type = $${idx++}`); params.push(type) }
    if (from) { where.push(`t.date >= $${idx++}`); params.push(from) }
    if (to) { where.push(`t.date <= $${idx++}`); params.push(to) }
    if (search) { where.push(`t.note ILIKE $${idx++}`); params.push(`%${search}%`) }
    if (tag_id) { where.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = $${idx++})`); params.push(tag_id) }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const countResult = await fastify.db.query(
      `SELECT COUNT(*) FROM transactions t ${whereClause}`,
      params
    )

    const result = await fastify.db.query(
      `SELECT t.*, a.name as account_name, a.currency as account_currency, a.type as account_type, c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = $1
       ${whereClause}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    )

    const transactionIds = result.rows.map(r => r.id)
    let tagsMap = {}
    if (transactionIds.length) {
      const tagRes = await fastify.db.query(
        `SELECT tt.transaction_id, tg.id, tg.name, tg.color
         FROM transaction_tags tt
         JOIN tags tg ON tg.id = tt.tag_id AND tg.user_id = $1
         WHERE tt.transaction_id = ANY($2)`,
        [userId, transactionIds]
      )
      for (const row of tagRes.rows) {
        if (!tagsMap[row.transaction_id]) tagsMap[row.transaction_id] = []
        tagsMap[row.transaction_id].push({ id: row.id, name: row.name, color: row.color })
      }
    }

    return {
      items: result.rows.map(r => ({ ...r, tags: tagsMap[r.id] || [] })),
      total: parseInt(countResult.rows[0].count, 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    }
  })

  // Create
  fastify.post('/transactions', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type', 'date'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', minimum: 0 },
          type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
          date: { type: 'string', format: 'date' },
          note: { type: 'string' },
          transfer_to_account_id: { type: ['integer', 'null'] },
          tags: { type: 'array', items: { type: 'integer' } }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { account_id, category_id, amount, type, date, note, transfer_to_account_id, tags } = request.body

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      // Validate account ownership
      const accRes = await client.query('SELECT id, currency, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
      if (accRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: 'Account not found' }
      }

      if (transfer_to_account_id) {
        const tgtRes = await client.query('SELECT id, currency FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
        if (tgtRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: 'Transfer target account not found' }
        }
      }

      if (category_id) {
        const catRes = await client.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
        if (catRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: 'Category not found' }
        }
      }

      const result = await client.query(
        'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, transfer_to_account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [userId, account_id, category_id, amount, type, date, note, transfer_to_account_id]
      )
      const transaction = result.rows[0]

      if (tags && tags.length) {
        const tagCheck = await client.query('SELECT id FROM tags WHERE id = ANY($1) AND user_id = $2', [tags, userId])
        if (tagCheck.rows.length !== tags.length) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: 'Invalid tags' }
        }
        const values = tags.map((_, i) => `($1, $${2 * i + 2}, $${2 * i + 3})`).join(',')
        await client.query(
          `INSERT INTO transaction_tags (transaction_id, tag_id, user_id) VALUES ${values}`,
          [transaction.id, ...tags.flatMap(tagId => [tagId, userId])]
        )
      }

      // Update account balance
      const sign = type === 'income' ? 1 : -1
      await client.query(
        'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
        [amount * sign, account_id, userId]
      )

      if (type === 'transfer' && transfer_to_account_id) {
        if (transfer_to_account_id === account_id) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: 'Transfer target cannot be the same as source account' }
        }
        const [srcRes, tgtRes] = await Promise.all([
          client.query('SELECT currency, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId]),
          client.query('SELECT currency, type FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
        ])
        const sourceCurrency = srcRes.rows[0]?.currency
        const targetCurrency = tgtRes.rows[0]?.currency

        let targetAmount = amount
        if (sourceCurrency && targetCurrency && sourceCurrency !== targetCurrency) {
          const rates = await loadRates(client)
          const converted = convertAmount(amount, sourceCurrency, targetCurrency, rates)
          if (converted === null) {
            await client.query('ROLLBACK')
            reply.code(400)
            return { error: 'exchange_rate_missing', message: `No exchange rate found for ${sourceCurrency} -> ${targetCurrency}` }
          }
          targetAmount = converted
        }

        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [targetAmount, transfer_to_account_id, userId]
        )
        // Create paired transaction
        await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, transfer_to_account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
          [userId, transfer_to_account_id, null, targetAmount, 'income', date, null, account_id]
        )
      }

      await client.query('COMMIT')

      // Check budget status for expense transactions
      if (type === 'expense' && category_id) {
        try {
          const lang = await getUserLang(fastify.db, userId)
          const budgetRes = await fastify.db.query(
            `SELECT b.id, b.amount as limit_amount, COALESCE(SUM(t.amount), 0) as spent, c.name as category_name
             FROM budgets b
             LEFT JOIN transactions t ON t.category_id = b.category_id AND t.type = 'expense' AND t.user_id = b.user_id
               AND t.date >= b.start_date
               AND t.date < CASE WHEN b.period = 'month' THEN b.start_date + INTERVAL '1 month' ELSE b.start_date + INTERVAL '7 days' END
             JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
             WHERE b.category_id = $1 AND b.is_active = true AND b.user_id = $2
             GROUP BY b.id, b.amount, c.name`,
            [category_id, userId]
          )
          for (const budget of budgetRes.rows) {
            const spent = parseFloat(budget.spent)
            const limit = parseFloat(budget.limit_amount)
            const pct = limit > 0 ? (spent / limit) : 0
            if (spent > limit) {
              const dup = await checkDuplicateNotification(fastify, { userId, type: 'budget_exceeded', entityId: budget.id })
              if (!dup) {
                const title = t('notifications.budget_exceeded', {}, lang)
                const message = t('notifications.budget_exceeded_body', { category: budget.category_name || '', amount: limit }, lang)
                await notify(fastify, userId, {
                  type: 'budget_exceeded', title, message,
                  data: { entity_id: budget.id, url: '/budgets' },
                  channels: ['bell', 'push', 'shoutrrr']
                })
              }
            } else if (pct >= 0.8 && pct < 1.0) {
              const dup = await checkDuplicateNotification(fastify, { userId, type: 'budget_warning', entityId: budget.id })
              if (!dup) {
                const title = t('notifications.budget_warning', {}, lang)
                const message = t('notifications.budget_warning_body', { category: budget.category_name || '', percent: Math.round(pct * 100) }, lang)
                await notify(fastify, userId, {
                  type: 'budget_warning', title, message,
                  data: { entity_id: budget.id, url: '/budgets' },
                  channels: ['bell', 'push']
                })
              }
            }
          }
        } catch (budgetErr) {
          fastify.log.warn(budgetErr, 'Budget check failed')
        }
      }

      // Check goal achievement for income transactions to goal accounts
      if (type === 'income' && account_id) {
        try {
          const lang = await getUserLang(fastify.db, userId)
          const goalRes = await fastify.db.query(
            `SELECT id, name, balance, target_amount FROM accounts WHERE id = $1 AND type = 'goal' AND target_amount > 0 AND user_id = $2`,
            [account_id, userId]
          )
          for (const goal of goalRes.rows) {
            const balance = parseFloat(goal.balance)
            const target = parseFloat(goal.target_amount)
            if (balance >= target) {
              const dup = await checkDuplicateNotification(fastify, { userId, type: 'goal_reached', entityId: goal.id })
              if (!dup) {
                const title = t('notifications.goal_reached', {}, lang)
                const message = t('notifications.goal_reached_body', { name: goal.name, balance, target }, lang)
                await notify(fastify, userId, {
                  type: 'goal_reached', title, message,
                  data: { entity_id: goal.id, url: `/accounts/${goal.id}` },
                  channels: ['bell', 'push', 'shoutrrr']
                })
              }
            }
          }
        } catch (goalErr) {
          fastify.log.warn(goalErr, 'Goal check failed')
        }
      }

      // Check for overdrawn account after transaction
      try {
        const lang = await getUserLang(fastify.db, userId)
        const accRes = await fastify.db.query('SELECT id, name, balance, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
        const acc = accRes.rows[0]
        if (acc && parseFloat(acc.balance) < 0) {
          const dup = await checkDuplicateNotification(fastify, { userId, type: 'account_overdrawn', entityId: acc.id })
          if (!dup) {
            const title = t('notifications.account_overdrawn', {}, lang)
            const message = t('notifications.account_overdrawn_body', { name: acc.name, balance: acc.balance }, lang)
            await notify(fastify, userId, {
              type: 'account_overdrawn', title, message,
              data: { entity_id: acc.id, url: '/accounts' },
              channels: ['bell', 'push', 'shoutrrr']
            })
          }
        }
        if (type === 'transfer' && transfer_to_account_id) {
          const tgtRes = await fastify.db.query('SELECT id, name, balance, type FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
          const tgt = tgtRes.rows[0]
          if (tgt && parseFloat(tgt.balance) < 0) {
            const dup = await checkDuplicateNotification(fastify, { userId, type: 'account_overdrawn', entityId: tgt.id })
            if (!dup) {
              const title = t('notifications.account_overdrawn', {}, lang)
              const message = t('notifications.account_overdrawn_body', { name: tgt.name, balance: tgt.balance }, lang)
              await notify(fastify, userId, {
                type: 'account_overdrawn', title, message,
                data: { entity_id: tgt.id, url: '/accounts' },
                channels: ['bell', 'push', 'shoutrrr']
              })
            }
          }
        }
      } catch (overErr) {
        fastify.log.warn(overErr, 'Overdrawn check failed')
      }

      reply.code(201)
      return transaction
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Update
  fastify.put('/transactions/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type', 'date'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', minimum: 0 },
          type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
          date: { type: 'string', format: 'date' },
          note: { type: 'string' },
          transfer_to_account_id: { type: ['integer', 'null'] },
          tags: { type: 'array', items: { type: 'integer' } }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params
    const { account_id, category_id, amount, type, date, note, transfer_to_account_id, tags } = request.body

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      const oldRes = await client.query(
        'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
        [id, userId]
      )
      if (oldRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: 'Transaction not found' }
      }
      const old = oldRes.rows[0]

      // Validate new account ownership
      const accRes = await client.query('SELECT id, currency, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
      if (accRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: 'Account not found' }
      }

      if (transfer_to_account_id) {
        const tgtRes = await client.query('SELECT id, currency FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
        if (tgtRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: 'Transfer target account not found' }
        }
      }

      if (category_id) {
        const catRes = await client.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
        if (catRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: 'Category not found' }
        }
      }

      // Revert old transaction balance effects
      const oldSign = old.type === 'income' ? 1 : -1
      await client.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
        [parseFloat(old.amount) * oldSign, old.account_id, userId]
      )
      if (old.type === 'transfer' && old.transfer_to_account_id) {
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [parseFloat(old.amount), old.transfer_to_account_id, userId]
        )
        await client.query(
          'DELETE FROM transactions WHERE transfer_to_account_id = $1 AND account_id = $2 AND user_id = $3 AND type = \'income\'',
          [old.account_id, old.transfer_to_account_id, userId]
        )
      }

      // Update main transaction
      const result = await client.query(
        'UPDATE transactions SET account_id = $1, category_id = $2, amount = $3, type = $4, date = $5, note = $6, transfer_to_account_id = $7, updated_at = NOW() WHERE id = $8 AND user_id = $9 RETURNING *',
        [account_id, category_id, amount, type, date, note, transfer_to_account_id, id, userId]
      )
      const transaction = result.rows[0]

      // Update tags
      await client.query('DELETE FROM transaction_tags WHERE transaction_id = $1', [id])
      if (tags && tags.length) {
        const tagCheck = await client.query('SELECT id FROM tags WHERE id = ANY($1) AND user_id = $2', [tags, userId])
        if (tagCheck.rows.length !== tags.length) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: 'Invalid tags' }
        }
        const values = tags.map((_, i) => `($1, $${2 * i + 2}, $${2 * i + 3})`).join(',')
        await client.query(
          `INSERT INTO transaction_tags (transaction_id, tag_id, user_id) VALUES ${values}`,
          [transaction.id, ...tags.flatMap(tagId => [tagId, userId])]
        )
      }

      // Apply new balance effects
      const sign = type === 'income' ? 1 : -1
      await client.query(
        'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
        [amount * sign, account_id, userId]
      )

      if (type === 'transfer' && transfer_to_account_id) {
        if (transfer_to_account_id === account_id) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: 'Transfer target cannot be the same as source account' }
        }
        const [srcRes, tgtRes] = await Promise.all([
          client.query('SELECT currency, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId]),
          client.query('SELECT currency, type FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
        ])
        const sourceCurrency = srcRes.rows[0]?.currency
        const targetCurrency = tgtRes.rows[0]?.currency

        let targetAmount = amount
        if (sourceCurrency && targetCurrency && sourceCurrency !== targetCurrency) {
          const rates = await loadRates(client)
          const converted = convertAmount(amount, sourceCurrency, targetCurrency, rates)
          if (converted === null) {
            await client.query('ROLLBACK')
            reply.code(400)
            return { error: 'exchange_rate_missing', message: `No exchange rate found for ${sourceCurrency} -> ${targetCurrency}` }
          }
          targetAmount = converted
        }

        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [targetAmount, transfer_to_account_id, userId]
        )
        await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, transfer_to_account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [userId, transfer_to_account_id, null, targetAmount, 'income', date, null, account_id]
        )
      }

      await client.query('COMMIT')
      return transaction
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Delete
  fastify.delete('/transactions/:id', async (request, reply) => {
    const userId = request.user.userId
    const { id } = request.params

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      const oldRes = await client.query(
        'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
        [id, userId]
      )
      if (oldRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: 'Transaction not found' }
      }
      const old = oldRes.rows[0]

      // Revert old balance effects
      const oldSign = old.type === 'income' ? 1 : -1
      await client.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
        [parseFloat(old.amount) * oldSign, old.account_id, userId]
      )
      if (old.type === 'transfer' && old.transfer_to_account_id) {
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [parseFloat(old.amount), old.transfer_to_account_id, userId]
        )
        await client.query(
          'DELETE FROM transactions WHERE transfer_to_account_id = $1 AND account_id = $2 AND user_id = $3 AND type = \'income\'',
          [old.account_id, old.transfer_to_account_id, userId]
        )
      }

      await client.query('DELETE FROM transaction_tags WHERE transaction_id = $1', [id])
      await client.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, userId])

      await client.query('COMMIT')
      reply.code(204)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}

export default transactionRoutes
