import { loadRates, convertAmount } from '../services/currency.js'
import { t, getUserLang } from '../services/i18n.js'
import { shiftDays, shiftMonth } from '../services/recurring-schedule.js'

async function demodataRoutes(fastify, opts) {
  // Clear all data for current user (except users)
  fastify.post('/admin/clear-database', async (request, reply) => {
    const userId = request.user.userId
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM debt_payments WHERE user_id = $1', [userId])
      await client.query('DELETE FROM debts WHERE user_id = $1', [userId])
      await client.query('DELETE FROM budgets WHERE user_id = $1', [userId])
      await client.query('DELETE FROM transactions WHERE user_id = $1', [userId])
      await client.query('DELETE FROM recurring_rules WHERE user_id = $1', [userId])
      await client.query('DELETE FROM notifications WHERE user_id = $1', [userId])
      await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId])
      await client.query('DELETE FROM accounts WHERE user_id = $1', [userId])
      // entity_shares has no FK to the shared entity: the caller's grants on the
      // accounts/budgets/debts/rules deleted above would linger as orphans.
      await client.query('DELETE FROM entity_shares WHERE owner_id = $1', [userId])
      await client.query('COMMIT')
      return { success: true, message: 'Database cleared successfully' }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Load demo data for current user
  fastify.post('/admin/load-demo', async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      // Serialize concurrent demo loads: two parallel requests must not both
      // pass the "no data yet" check and double-insert.
      await client.query('SELECT pg_advisory_xact_lock(654321)')
      const accountsResult = await client.query('SELECT 1 FROM accounts WHERE user_id = $1 LIMIT 1', [userId])
      if (accountsResult.rows.length > 0) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.demodata_exists', {}, lang) }
      }

      // --- Accounts ---
      const accounts = [
        { name: 'Main Card', type: 'card', currency: 'USD', balance: 1250.50, color: '#3b82f6', icon: 'creditCard', sort_order: 1 },
        { name: 'Cash', type: 'cash', currency: 'USD', balance: 150.00, color: '#10b981', icon: 'banknote', sort_order: 2 },
        { name: 'Savings Account', type: 'goal', currency: 'USD', balance: 5000.00, target_amount: 15000, color: '#f59e0b', icon: 'piggyBank', sort_order: 3 },
        { name: 'BTC Wallet', type: 'crypto', currency: 'BTC', balance: 0.05, color: '#f7931a', icon: 'bitcoin', sort_order: 4 },
        { name: 'ETH Wallet', type: 'crypto', currency: 'ETH', balance: 0.5, color: '#627eea', icon: 'ethereum', sort_order: 5 }
      ]

      const accountIds = []
      const accountMap = new Map()
      for (const acc of accounts) {
        const result = await client.query(
          'INSERT INTO accounts (user_id, name, type, currency, balance, color, icon, target_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
          [userId, acc.name, acc.type, acc.currency, acc.balance, acc.color, acc.icon, acc.target_amount, acc.sort_order]
        )
        accountIds.push(result.rows[0].id)
        accountMap.set(result.rows[0].id, acc)
      }

      const rates = await loadRates(client)

      // --- Categories ---
      const categories = [
        { name: 'Salary', type: 'income', color: '#10b981', icon: 'wallet' },
        { name: 'Freelance', type: 'income', color: '#059669', icon: 'briefcase' },
        { name: 'Food', type: 'expense', color: '#f43f5e', icon: 'utensils' },
        { name: 'Transport', type: 'expense', color: '#f59e0b', icon: 'car' },
        { name: 'Entertainment', type: 'expense', color: '#8b5cf6', icon: 'gamepad2' },
        { name: 'Utilities', type: 'expense', color: '#3b82f6', icon: 'home' },
        { name: 'Clothes', type: 'expense', color: '#ec4899', icon: 'tshirt' },
        { name: 'Health', type: 'expense', color: '#14b8a6', icon: 'heartPulse' },
        { name: 'Subscriptions', type: 'expense', color: '#6366f1', icon: 'creditCard' }
      ]

      // Categories and tags are global: only an admin may create them. An
      // existing category/tag with the same name is reused; a missing one is
      // created for an admin and left out (null) for anyone else.
      const isAdmin = request.user.role === 'admin'
      const categoryIds = []
      for (const cat of categories) {
        const existing = await client.query(
          'SELECT id FROM categories WHERE lower(name) = lower($1) AND type = $2 ORDER BY id LIMIT 1',
          [cat.name, cat.type]
        )
        if (existing.rows.length > 0) {
          categoryIds.push(existing.rows[0].id)
        } else if (isAdmin) {
          const result = await client.query(
            'INSERT INTO categories (name, type, color, icon) VALUES ($1, $2, $3, $4) RETURNING id',
            [cat.name, cat.type, cat.color, cat.icon]
          )
          categoryIds.push(result.rows[0].id)
        } else {
          categoryIds.push(null)
        }
      }

      // --- Tags ---
      const tags = [
        { name: 'Essential', color: '#ef4444' },
        { name: 'Desired', color: '#f59e0b' },
        { name: 'Investment', color: '#10b981' },
        { name: 'Gift', color: '#8b5cf6' }
      ]

      const tagIds = []
      for (const tag of tags) {
        const existing = await client.query(
          'SELECT id FROM tags WHERE lower(name) = lower($1) ORDER BY id LIMIT 1',
          [tag.name]
        )
        if (existing.rows.length > 0) {
          tagIds.push(existing.rows[0].id)
        } else if (isAdmin) {
          const result = await client.query(
            'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING id',
            [tag.name, tag.color]
          )
          tagIds.push(result.rows[0].id)
        }
      }

      // --- Transactions ---
      // Calendar days are computed from the database's CURRENT_DATE with string
      // arithmetic: the Node clock runs in another timezone, and local-midnight
      // Dates passed through toISOString() landed a day early.
      const { rows: [{ today }] } = await client.query('SELECT CURRENT_DATE::text AS today')
      const currentMonth = today.slice(0, 7)
      const dayInMonth = (monthOffset, day) => `${shiftMonth(currentMonth, monthOffset)}-${String(day).padStart(2, '0')}`

      async function createTransaction(txData, pairId = null) {
        const result = await client.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, transfer_to_account_id, transfer_pair_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
          [userId, txData.account_id, txData.category_id, txData.amount, txData.type, txData.date, txData.note, txData.transfer_to_account_id, pairId]
        )
        const txId = result.rows[0].id

        const sign = txData.type === 'income' ? 1 : -1
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [txData.amount * sign, txData.account_id, userId]
        )

        return txId
      }

      const transactionIds = []

      for (let i = 30; i >= 0; i--) {
        const dateStr = shiftDays(today, -i)
        const dayOfMonth = Number(dateStr.slice(8, 10))

        if (dayOfMonth === 1 || dayOfMonth === 15) {
          const txId = await createTransaction({
            account_id: accountIds[0],
            category_id: categoryIds[0],
            amount: 2500 + Math.random() * 300,
            type: 'income',
            date: dateStr,
            note: 'Salary'
          })
          transactionIds.push(txId)
        }

        if (dayOfMonth === 10) {
          const txId = await createTransaction({
            account_id: accountIds[0],
            category_id: categoryIds[1],
            amount: 500 + Math.random() * 200,
            type: 'income',
            date: dateStr,
            note: 'Freelance project'
          })
          transactionIds.push(txId)
        }

        const expenseCount = Math.floor(Math.random() * 3) + 1
        for (let j = 0; j < expenseCount; j++) {
          const catIndex = 2 + Math.floor(Math.random() * 7)
          const amount = [
            10 + Math.random() * 50,
            5 + Math.random() * 25,
            20 + Math.random() * 100,
            50 + Math.random() * 150,
            30 + Math.random() * 200,
            20 + Math.random() * 80,
            10 + Math.random() * 30
          ][catIndex - 2] || 20

          const txId = await createTransaction({
            account_id: Math.random() > 0.7 ? accountIds[1] : accountIds[0],
            category_id: categoryIds[catIndex],
            amount: amount,
            type: 'expense',
            date: dateStr,
            note: ['Grocery shopping', 'Taxi', 'Movies', 'Coffee', 'Utilities payment', 'New shirt', 'Pharmacy'][Math.floor(Math.random() * 7)]
          })
          transactionIds.push(txId)
        }

        if (Math.random() > 0.85) {
          const amount = 100 + Math.random() * 300
          const txId = await createTransaction({
            account_id: accountIds[0],
            category_id: null,
            amount: amount,
            type: 'transfer',
            date: dateStr,
            note: 'Transfer to savings',
            transfer_to_account_id: accountIds[2]
          })
          transactionIds.push(txId)

          const pairedTxId = await createTransaction({
            account_id: accountIds[2],
            category_id: null,
            amount: amount,
            type: 'income',
            date: dateStr,
            note: null,
            transfer_to_account_id: accountIds[0]
          }, txId)
          transactionIds.push(pairedTxId)
          await client.query('UPDATE transactions SET transfer_pair_id = $1 WHERE id = $2', [pairedTxId, txId])
        }

        if (Math.random() > 0.9) {
          const cryptoAccountId = Math.random() > 0.5 ? accountIds[3] : accountIds[4]
          const cryptoAccount = accountMap.get(cryptoAccountId)
          const usdAmount = 100 + Math.random() * 500

          let cryptoAmount = usdAmount
          if (cryptoAccount.currency !== 'USD') {
            const converted = convertAmount(usdAmount, 'USD', cryptoAccount.currency, rates)
            if (converted !== null) {
              cryptoAmount = converted
            }
          }

          const txId = await createTransaction({
            account_id: accountIds[0],
            category_id: null,
            amount: usdAmount,
            type: 'transfer',
            date: dateStr,
            note: 'Buy crypto',
            transfer_to_account_id: cryptoAccountId
          })
          transactionIds.push(txId)

          const pairedTxId = await createTransaction({
            account_id: cryptoAccountId,
            category_id: null,
            amount: cryptoAmount,
            type: 'income',
            date: dateStr,
            note: null,
            transfer_to_account_id: accountIds[0]
          }, txId)
          transactionIds.push(pairedTxId)
          await client.query('UPDATE transactions SET transfer_pair_id = $1 WHERE id = $2', [pairedTxId, txId])
        }

        if (Math.random() > 0.92) {
          const txId = await createTransaction({
            account_id: accountIds[2],
            category_id: null,
            amount: 200 + Math.random() * 300,
            type: 'income',
            date: dateStr,
            note: 'Deposit to savings',
            transfer_to_account_id: null
          })
          transactionIds.push(txId)
        }

        if (Math.random() > 0.96) {
          const txId = await createTransaction({
            account_id: accountIds[2],
            category_id: categoryIds[2],
            amount: 50 + Math.random() * 150,
            type: 'expense',
            date: dateStr,
            note: 'Withdrawal for grocery',
            transfer_to_account_id: null
          })
          transactionIds.push(txId)
        }

        if (Math.random() > 0.95) {
          const cryptoAccountId = Math.random() > 0.5 ? accountIds[3] : accountIds[4]
          const cryptoAccount = accountMap.get(cryptoAccountId)
          const rewardAmount = cryptoAccount.currency === 'BTC' ? 0.0001 + Math.random() * 0.001 : 0.001 + Math.random() * 0.01

          const txId = await createTransaction({
            account_id: cryptoAccountId,
            category_id: categoryIds[1],
            amount: rewardAmount,
            type: 'income',
            date: dateStr,
            note: 'Staking rewards',
            transfer_to_account_id: null
          })
          transactionIds.push(txId)
        }
      }

      for (const txId of transactionIds) {
        if (Math.random() > 0.5) {
          const numTags = Math.floor(Math.random() * 2) + 1
          const selectedTags = [...tagIds].sort(() => Math.random() - 0.5).slice(0, numTags)
          for (const tagId of selectedTags) {
            await client.query(
              'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)',
              [txId, tagId]
            )
          }
        }
      }

      // --- Budgets ---
      // A budget needs a target: one whose demo category is unavailable is skipped
      for (const [categoryId, amount] of [[categoryIds[2], 600], [categoryIds[4], 200], [categoryIds[5], 250]]) {
        if (categoryId === null) continue
        await client.query(
          'INSERT INTO budgets (user_id, category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5, $6)',
          [userId, categoryId, amount, 'USD', 'month', today]
        )
      }

      // --- Debts ---
      await client.query(
        'INSERT INTO debts (user_id, name, counterparty, amount, currency, type, due_date, description, status, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [userId, 'Loan to friend', 'John Doe', 300, 'USD', 'lend', dayInMonth(1, 15), 'Borrowed until payday', 'active', accountIds[0]]
      )
      await client.query(
        'INSERT INTO debts (user_id, name, counterparty, amount, currency, type, due_date, description, status, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [userId, 'Phone Loan', 'Bank of America', 1200, 'USD', 'borrow', dayInMonth(6, 1), '12-month installment', 'active', accountIds[0]]
      )

      // --- Recurring ---
      await client.query(
        'INSERT INTO recurring_rules (user_id, account_id, category_id, amount, currency, type, frequency, next_date, note, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [userId, accountIds[0], categoryIds[5], 150, 'USD', 'expense', 'monthly', dayInMonth(1, 5), 'Utility bills', true]
      )
      await client.query(
        'INSERT INTO recurring_rules (user_id, account_id, category_id, amount, currency, type, frequency, next_date, note, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [userId, accountIds[0], categoryIds[8], 15, 'USD', 'expense', 'monthly', dayInMonth(1, 10), 'Netflix subscription', true]
      )
      await client.query(
        'INSERT INTO recurring_rules (user_id, account_id, category_id, amount, currency, type, frequency, next_date, note, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [userId, accountIds[0], categoryIds[0], 2500, 'USD', 'income', 'monthly', dayInMonth(1, 15), 'Salary', true]
      )

      await client.query('COMMIT')
      return { success: true, message: 'Demo data loaded successfully' }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}

export default demodataRoutes
