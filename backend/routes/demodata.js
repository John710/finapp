import { loadRates, convertAmount } from '../services/currency.js'

async function demodataRoutes(fastify, opts) {
  // Clear all data (except users)
  fastify.post('/admin/clear-database', async (request, reply) => {
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM debt_payments')
      await client.query('DELETE FROM debts')
      await client.query('DELETE FROM budgets')
      await client.query('DELETE FROM transaction_tags')
      await client.query('DELETE FROM transactions')
      await client.query('DELETE FROM tags')
      await client.query('DELETE FROM categories')
      await client.query('DELETE FROM recurring_rules')
      await client.query('DELETE FROM notifications')
      await client.query('DELETE FROM push_subscriptions')
      await client.query('DELETE FROM accounts')
      await client.query('COMMIT')
      return { success: true, message: 'Database cleared successfully' }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Load demo data
  fastify.post('/admin/load-demo', async (request, reply) => {
    // First check if there's already data
    const accountsResult = await fastify.db.query('SELECT 1 FROM accounts LIMIT 1')
    if (accountsResult.rows.length > 0) {
      reply.code(400)
      return { error: 'Database already has data. Clear it first.' }
    }

    // Get user
    const userResult = await fastify.db.query('SELECT id FROM users LIMIT 1')
    const userId = userResult.rows[0]?.id

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

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
          'INSERT INTO accounts (name, type, currency, balance, color, icon, target_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [acc.name, acc.type, acc.currency, acc.balance, acc.color, acc.icon, acc.target_amount, acc.sort_order]
        )
        accountIds.push(result.rows[0].id)
        accountMap.set(result.rows[0].id, acc)
      }

      // Load exchange rates
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

      const categoryIds = []
      for (const cat of categories) {
        const result = await client.query(
          'INSERT INTO categories (name, type, color, icon) VALUES ($1, $2, $3, $4) RETURNING id',
          [cat.name, cat.type, cat.color, cat.icon]
        )
        categoryIds.push(result.rows[0].id)
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
        const result = await client.query(
          'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING id',
          [tag.name, tag.color]
        )
        tagIds.push(result.rows[0].id)
      }

      // --- Transactions ---
      const today = new Date()
      const transactions = []
      
      // Helper to create transaction and update balances
      async function createTransaction(txData) {
        const result = await client.query(
          'INSERT INTO transactions (account_id, category_id, amount, type, date, note, transfer_to_account_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [txData.account_id, txData.category_id, txData.amount, txData.type, txData.date, txData.note, txData.transfer_to_account_id]
        )
        const txId = result.rows[0].id
        
        // Update account balance
        const sign = txData.type === 'income' ? 1 : -1
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
          [txData.amount * sign, txData.account_id]
        )
        
        return txId
      }

      const transactionIds = []
      
      // Generate last 30 days of transactions
      for (let i = 30; i >= 0; i--) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]

        // Random income (salary on 1st and 15th)
        if (date.getDate() === 1 || date.getDate() === 15) {
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

        if (date.getDate() === 10) {
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

        // Random expenses
        const expenseCount = Math.floor(Math.random() * 3) + 1
        for (let j = 0; j < expenseCount; j++) {
          const catIndex = 2 + Math.floor(Math.random() * 7)
          const amount = [
            10 + Math.random() * 50, // Food
            5 + Math.random() * 25,  // Transport
            20 + Math.random() * 100, // Entertainment
            50 + Math.random() * 150, // Utilities
            30 + Math.random() * 200, // Clothes
            20 + Math.random() * 80,  // Health
            10 + Math.random() * 30   // Subscriptions
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

        // Occasional transfer to savings
        if (Math.random() > 0.85) {
          const amount = 100 + Math.random() * 300
          // Source transaction
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
          
          // Paired transaction (income on savings account)
          const pairedTxId = await createTransaction({
            account_id: accountIds[2],
            category_id: null,
            amount: amount,
            type: 'income',
            date: dateStr,
            note: null,
            transfer_to_account_id: accountIds[0]
          })
          transactionIds.push(pairedTxId)
        }

        // Occasional crypto transaction
        if (Math.random() > 0.9) {
          const cryptoAccountId = Math.random() > 0.5 ? accountIds[3] : accountIds[4]
          const cryptoAccount = accountMap.get(cryptoAccountId)
          const usdAmount = 100 + Math.random() * 500
          
          // Convert USD to crypto
          let cryptoAmount = usdAmount
          if (cryptoAccount.currency !== 'USD') {
            const converted = convertAmount(usdAmount, 'USD', cryptoAccount.currency, rates)
            if (converted !== null) {
              cryptoAmount = converted
            }
          }
          
          // Source transaction (transfer from USD account)
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
          
          // Paired transaction (income on crypto account)
          const pairedTxId = await createTransaction({
            account_id: cryptoAccountId,
            category_id: null,
            amount: cryptoAmount,
            type: 'income',
            date: dateStr,
            note: null,
            transfer_to_account_id: accountIds[0]
          })
          transactionIds.push(pairedTxId)
        }

        // Occasional deposit to savings
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

        // Occasional withdrawal from savings
        if (Math.random() > 0.96) {
          const txId = await createTransaction({
            account_id: accountIds[2],
            category_id: categoryIds[2], // Food category
            amount: 50 + Math.random() * 150,
            type: 'expense',
            date: dateStr,
            note: 'Withdrawal for grocery',
            transfer_to_account_id: null
          })
          transactionIds.push(txId)
        }

        // Occasional crypto income (e.g., staking rewards)
        if (Math.random() > 0.95) {
          const cryptoAccountId = Math.random() > 0.5 ? accountIds[3] : accountIds[4]
          const cryptoAccount = accountMap.get(cryptoAccountId)
          const rewardAmount = cryptoAccount.currency === 'BTC' ? 0.0001 + Math.random() * 0.001 : 0.001 + Math.random() * 0.01
          
          const txId = await createTransaction({
            account_id: cryptoAccountId,
            category_id: categoryIds[1], // Freelance/income category
            amount: rewardAmount,
            type: 'income',
            date: dateStr,
            note: 'Staking rewards',
            transfer_to_account_id: null
          })
          transactionIds.push(txId)
        }
      }

      // Add random tags to transactions
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
      await client.query(
        'INSERT INTO budgets (category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5)',
        [categoryIds[2], 600, 'USD', 'month', today.toISOString().split('T')[0]]
      )
      await client.query(
        'INSERT INTO budgets (category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5)',
        [categoryIds[4], 200, 'USD', 'month', today.toISOString().split('T')[0]]
      )
      await client.query(
        'INSERT INTO budgets (category_id, amount, currency, period, start_date) VALUES ($1, $2, $3, $4, $5)',
        [categoryIds[5], 250, 'USD', 'month', today.toISOString().split('T')[0]]
      )

      // --- Debts ---
      await client.query(
        'INSERT INTO debts (name, counterparty, amount, currency, type, due_date, description, status, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['Loan to friend', 'John Doe', 300, 'USD', 'lend', new Date(today.getFullYear(), today.getMonth() + 1, 15).toISOString().split('T')[0], 'Borrowed until payday', 'active', accountIds[0]]
      )
      await client.query(
        'INSERT INTO debts (name, counterparty, amount, currency, type, due_date, description, status, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['Phone Loan', 'Bank of America', 1200, 'USD', 'borrow', new Date(today.getFullYear(), today.getMonth() + 6, 1).toISOString().split('T')[0], '12-month installment', 'active', accountIds[0]]
      )

      // --- Recurring ---
      const nextMonth1 = new Date(today.getFullYear(), today.getMonth() + 1, 5)
      const nextMonth2 = new Date(today.getFullYear(), today.getMonth() + 1, 10)
      const nextMonth3 = new Date(today.getFullYear(), today.getMonth() + 1, 15)
      
      await client.query(
        'INSERT INTO recurring_rules (account_id, category_id, amount, currency, type, frequency, next_date, note, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [accountIds[0], categoryIds[5], 150, 'USD', 'expense', 'monthly', nextMonth1.toISOString().split('T')[0], 'Utility bills', true]
      )
      await client.query(
        'INSERT INTO recurring_rules (account_id, category_id, amount, currency, type, frequency, next_date, note, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [accountIds[0], categoryIds[8], 15, 'USD', 'expense', 'monthly', nextMonth2.toISOString().split('T')[0], 'Netflix subscription', true]
      )
      await client.query(
        'INSERT INTO recurring_rules (account_id, category_id, amount, currency, type, frequency, next_date, note, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [accountIds[0], categoryIds[0], 2500, 'USD', 'income', 'monthly', nextMonth3.toISOString().split('T')[0], 'Salary', true]
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
