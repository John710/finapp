import fp from 'fastify-plugin'
import cron from 'node-cron'
import { t, getUserLang } from '../services/i18n.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'

function addPeriod(date, frequency) {
  const d = new Date(date)
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'biweekly': d.setDate(d.getDate() + 14); break
    case 'monthly': d.setMonth(d.getMonth() + 1); break
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break
  }
  return d.toISOString().split('T')[0]
}

async function cronPlugin(fastify, opts) {
  // Run every hour — recurring transactions
  cron.schedule('0 * * * *', async () => {
    fastify.log.info('Running recurring transactions check')
    try {
      const lang = await getUserLang(fastify.db)
      const result = await fastify.db.query(
        'SELECT * FROM recurring_rules WHERE is_active = true AND next_date <= CURRENT_DATE'
      )

      for (const rule of result.rows) {
        await fastify.db.query(
          'INSERT INTO transactions (account_id, category_id, amount, type, date, note, recurring_rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [rule.account_id, rule.category_id, rule.amount, rule.type, rule.next_date, rule.note, rule.id]
        )

        // Update account balance
        const sign = rule.type === 'income' ? 1 : -1
        await fastify.db.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
          [rule.amount * sign, rule.account_id]
        )

        // Update next_date
        const newDate = addPeriod(rule.next_date, rule.frequency)
        await fastify.db.query(
          'UPDATE recurring_rules SET next_date = $1 WHERE id = $2',
          [newDate, rule.id]
        )

        fastify.log.info(`Created recurring transaction for rule ${rule.id}`)

        // Notify user
        try {
          const userRes = await fastify.db.query('SELECT id FROM users LIMIT 1')
          const userId = userRes.rows[0]?.id
          if (userId) {
            const title = t('notifications.recurring_created', {}, lang)
            const message = t('notifications.recurring_created_body', { name: rule.note || rule.type, amount: rule.amount, currency: '' }, lang)
            await notify(fastify, userId, {
              type: 'recurring_created', title, message,
              data: { entity_id: rule.id, url: '/transactions' },
              channels: ['bell', 'push', 'shoutrrr']
            })
          }
        } catch (notifErr) {
          fastify.log.warn(notifErr, 'Recurring notification failed')
        }
      }
    } catch (err) {
      fastify.log.error(err)
    }
  })

  // Run daily at 09:00 — debt due date check
  cron.schedule('0 9 * * *', async () => {
    fastify.log.info('Running debt due date check')
    try {
      const lang = await getUserLang(fastify.db)
      const result = await fastify.db.query(
        `SELECT id, name, counterparty, due_date, type
         FROM debts
         WHERE status != 'paid' AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + INTERVAL '3 days'`
      )

      const userRes = await fastify.db.query('SELECT id FROM users LIMIT 1')
      const userId = userRes.rows[0]?.id
      if (!userId) return

      for (const debt of result.rows) {
        const dup = await checkDuplicateNotification(fastify, { userId, type: 'debt_due_soon', entityId: debt.id, hours: 24 })
        if (!dup) {
          const title = t('notifications.debt_due_soon', {}, lang)
          const message = t('notifications.debt_due_soon_body', { name: debt.name, date: debt.due_date }, lang)
          await notify(fastify, userId, {
            type: 'debt_due_soon', title, message,
            data: { entity_id: debt.id, url: '/debts' },
            channels: ['bell', 'push', 'shoutrrr']
          })
        }
      }
    } catch (err) {
      fastify.log.error(err)
    }
  })
}

export default fp(cronPlugin, { name: 'cron' })
