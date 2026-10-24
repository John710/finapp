import { t, getUserLang } from '../services/i18n.js'
import { loadRates, convertAmount } from '../services/currency.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'

// The paired income leg of a transfer and the source transfer row reference
// each other via transfer_pair_id (the leg is inserted first with a link to the
// source, then the source row gets the leg's id). The created_at fallback only
// covers rows created before this column existed.
export async function findTransferLeg(client, transfer) {
  if (transfer.transfer_pair_id) {
    const r = await client.query(
      'SELECT id, amount, type FROM transactions WHERE id = $1 AND user_id = $2',
      [transfer.transfer_pair_id, transfer.user_id]
    )
    if (r.rows.length) return r.rows[0]
  }
  const r = await client.query(
    "SELECT id, amount, type FROM transactions WHERE type = 'income' AND account_id = $1 AND transfer_to_account_id = $2 AND user_id = $3 AND transfer_pair_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    [transfer.transfer_to_account_id, transfer.account_id, transfer.user_id]
  )
  return r.rows[0] || null
}

function isPairedLeg(tx) {
  return tx.type === 'income' && !!tx.transfer_pair_id
}

async function transactionRoutes(fastify, opts) {
  // List with filters
  fastify.get('/transactions', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: 'integer' },
          type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
          from: { type: 'string', format: 'date' },
          to: { type: 'string', format: 'date' },
          search: { type: 'string', maxLength: 100 },
          tag_id: { type: 'integer' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request, reply) => {
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
    if (search) {
      // Escape LIKE wildcards so user input cannot widen the pattern
      const escaped = search.replace(/[\\%_]/g, (m) => '\\' + m)
      where.push(`t.note ILIKE $${idx++}`); params.push(`%${escaped}%`)
    }
    if (tag_id) { where.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = $${idx++})`); params.push(tag_id) }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const countResult = await fastify.db.query(
      `SELECT COUNT(*) FROM transactions t ${whereClause} AND t.parent_id IS NULL`,
      params
    )

    const result = await fastify.db.query(
      `SELECT t.*, a.name as account_name, a.currency as account_currency, a.type as account_type, c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = $1
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = $1
       ${whereClause}
       ORDER BY t.date DESC, t.parent_id NULLS FIRST, t.created_at DESC
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
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
          date: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 1000 },
          transfer_to_account_id: { type: ['integer', 'null'] },
          tags: { type: 'array', items: { type: 'integer' }, maxItems: 50 },
          splits: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              required: ['category_id', 'amount'],
              properties: {
                category_id: { type: 'integer' },
                amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
                note: { type: 'string', maxLength: 1000 }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { account_id, category_id, amount, type, date, note, transfer_to_account_id, tags, splits } = request.body

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      // A transfer must move money to another account — otherwise it would
      // silently deduct from the source without crediting anything.
      if (type === 'transfer') {
        if (!transfer_to_account_id) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.transfer_target_required', {}, lang) }
        }
        if (transfer_to_account_id === account_id) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.transfer_target_same', {}, lang) }
        }
      }

      // Split transactions: the parent carries the full amount and the balance
      // effect; children hold per-category amounts and are bookkeeping only.
      const hasSplits = Array.isArray(splits) && splits.length > 0
      if (hasSplits) {
        if (type === 'transfer') {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.split_transfer', {}, lang) }
        }
        const splitSum = splits.reduce((s, sp) => s + sp.amount, 0)
        if (Math.abs(splitSum - amount) > 0.005) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.split_sum_mismatch', {}, lang) }
        }
        for (const sp of splits) {
          const catRes = await client.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [sp.category_id, userId])
          if (catRes.rows.length === 0) {
            await client.query('ROLLBACK')
            reply.code(404)
            return { error: t('errors.category_not_found', {}, lang) }
          }
        }
      }

      // Validate account ownership
      const accRes = await client.query('SELECT id, currency, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
      if (accRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.account_not_found', {}, lang) }
      }

      if (transfer_to_account_id) {
        const tgtRes = await client.query('SELECT id, currency FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
        if (tgtRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.transfer_target_not_found', {}, lang) }
        }
      }

      if (category_id) {
        const catRes = await client.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
        if (catRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.category_not_found', {}, lang) }
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
          return { error: t('errors.invalid_tags', {}, lang) }
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

      // Split children: same account/date/type as the parent, no balance effect
      if (hasSplits) {
        await client.query(
          'UPDATE transactions SET is_split = true, category_id = NULL WHERE id = $1 AND user_id = $2',
          [transaction.id, userId]
        )
        for (const sp of splits) {
          await client.query(
            'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [userId, account_id, sp.category_id, sp.amount, type, date, sp.note || null, transaction.id]
          )
        }
      }

      if (type === 'transfer' && transfer_to_account_id) {
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
            return { error: t('errors.exchange_rate_missing', { from: sourceCurrency, to: targetCurrency }, lang) }
          }
          targetAmount = converted
        }

        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [targetAmount, transfer_to_account_id, userId]
        )
        // Create the paired income leg and link both rows to each other
        const legRes = await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, transfer_to_account_id, transfer_pair_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
          [userId, transfer_to_account_id, null, targetAmount, 'income', date, null, account_id, transaction.id]
        )
        await client.query(
          'UPDATE transactions SET transfer_pair_id = $1 WHERE id = $2 AND user_id = $3',
          [legRes.rows[0].id, transaction.id, userId]
        )
        transaction.transfer_pair_id = legRes.rows[0].id
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
               AND t.date >= CASE WHEN b.period = 'week' THEN date_trunc('week', CURRENT_DATE) ELSE date_trunc('month', CURRENT_DATE) END
               AND t.date < CASE WHEN b.period = 'week' THEN date_trunc('week', CURRENT_DATE) + INTERVAL '7 days' ELSE date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' END
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
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      },
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type', 'date'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
          date: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 1000 },
          transfer_to_account_id: { type: ['integer', 'null'] },
          tags: { type: 'array', items: { type: 'integer' }, maxItems: 50 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    const { account_id, category_id, amount, type, date, note, transfer_to_account_id, tags } = request.body

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      // Lock the row so a concurrent PUT/DELETE of the same transaction cannot
      // double-revert the balance effects.
      const oldRes = await client.query(
        'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, userId]
      )
      if (oldRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.transaction_not_found', {}, lang) }
      }
      const old = oldRes.rows[0]

      if (old.transfer_pair_id && old.type === 'income') {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.transfer_leg_edit', {}, lang) }
      }

      // Splits are managed as a whole: delete and recreate (children cascade)
      if (old.is_split) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.split_edit', {}, lang) }
      }
      if (old.parent_id) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.split_child_edit', {}, lang) }
      }

      if (type === 'transfer') {
        if (!transfer_to_account_id) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.transfer_target_required', {}, lang) }
        }
        if (transfer_to_account_id === account_id) {
          await client.query('ROLLBACK')
          reply.code(400)
          return { error: t('errors.transfer_target_same', {}, lang) }
        }
      }

      // Validate new account ownership
      const accRes = await client.query('SELECT id, currency, type FROM accounts WHERE id = $1 AND user_id = $2', [account_id, userId])
      if (accRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.account_not_found', {}, lang) }
      }

      if (transfer_to_account_id) {
        const tgtRes = await client.query('SELECT id, currency FROM accounts WHERE id = $1 AND user_id = $2', [transfer_to_account_id, userId])
        if (tgtRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.transfer_target_not_found', {}, lang) }
        }
      }

      if (category_id) {
        const catRes = await client.query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [category_id, userId])
        if (catRes.rows.length === 0) {
          await client.query('ROLLBACK')
          reply.code(404)
          return { error: t('errors.category_not_found', {}, lang) }
        }
      }

      // Revert old transaction balance effects
      const oldSign = old.type === 'income' ? 1 : -1
      await client.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
        [parseFloat(old.amount) * oldSign, old.account_id, userId]
      )
      if (old.type === 'transfer' && old.transfer_to_account_id) {
        // Reverse the amount that was actually credited to the target account
        // (the paired leg amount, in the target currency) — not the source
        // amount, which differs once currencies differ.
        const leg = await findTransferLeg(client, old)
        const creditedAmount = leg ? parseFloat(leg.amount) : parseFloat(old.amount)
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [creditedAmount, old.transfer_to_account_id, userId]
        )
        if (leg) {
          await client.query(
            'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
            [leg.id, userId]
          )
        }
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
          return { error: t('errors.invalid_tags', {}, lang) }
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
            return { error: t('errors.exchange_rate_missing', { from: sourceCurrency, to: targetCurrency }, lang) }
          }
          targetAmount = converted
        }

        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [targetAmount, transfer_to_account_id, userId]
        )
        const legRes = await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, transfer_to_account_id, transfer_pair_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
          [userId, transfer_to_account_id, null, targetAmount, 'income', date, null, account_id, transaction.id]
        )
        await client.query(
          'UPDATE transactions SET transfer_pair_id = $1 WHERE id = $2 AND user_id = $3',
          [legRes.rows[0].id, transaction.id, userId]
        )
        transaction.transfer_pair_id = legRes.rows[0].id
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
  fastify.delete('/transactions/:id', {
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

      const oldRes = await client.query(
        'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, userId]
      )
      if (oldRes.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.transaction_not_found', {}, lang) }
      }
      const old = oldRes.rows[0]

      if (isPairedLeg(old)) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.transfer_leg_delete', {}, lang) }
      }

      // Split children are removed together with their parent (FK cascade)
      if (old.parent_id) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.split_child_delete', {}, lang) }
      }

      // Revert old balance effects
      const oldSign = old.type === 'income' ? 1 : -1
      await client.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
        [parseFloat(old.amount) * oldSign, old.account_id, userId]
      )
      if (old.type === 'transfer' && old.transfer_to_account_id) {
        // Reverse the amount actually credited to the target (paired leg amount)
        const leg = await findTransferLeg(client, old)
        const creditedAmount = leg ? parseFloat(leg.amount) : parseFloat(old.amount)
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3',
          [creditedAmount, old.transfer_to_account_id, userId]
        )
        if (leg) {
          await client.query(
            'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
            [leg.id, userId]
          )
        }
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
