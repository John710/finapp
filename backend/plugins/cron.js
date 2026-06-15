import fp from 'fastify-plugin'
import cron from 'node-cron'
import { t, getUserLang } from '../services/i18n.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'

function frequencyToInterval(frequency) {
  switch (frequency) {
    case 'daily': return '1 day'
    case 'weekly': return '7 days'
    case 'biweekly': return '14 days'
    case 'monthly': return '1 month'
    case 'yearly': return '1 year'
    default: return '1 month'
  }
}

async function cronPlugin(fastify, opts) {
  const jobs = []

  function schedule(expression, task) {
    let running = false
    const job = cron.schedule(expression, async () => {
      if (running) {
        fastify.log.warn(`Cron job ${expression} is still running, skipping overlap`)
        return
      }
      running = true
      try {
        await task()
      } catch (err) {
        fastify.log.error(err)
      } finally {
        running = false
      }
    })
    jobs.push(job)
  }

  fastify.decorate('schedule', schedule)

  fastify.addHook('onClose', async () => {
    jobs.forEach(j => j.stop())
  })

  // Run every hour — recurring transactions
  schedule('0 * * * *', async () => {
    fastify.log.info('Running recurring transactions check')
    const usersRes = await fastify.db.query('SELECT id FROM users ORDER BY id')
    for (const user of usersRes.rows) {
      const userId = user.id
      const lang = await getUserLang(fastify.db, userId)
      const result = await fastify.db.query(
        'SELECT * FROM recurring_rules WHERE is_active = true AND next_date <= CURRENT_DATE AND user_id = $1',
        [userId]
      )

      for (const rule of result.rows) {
        await fastify.db.query(
          'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, recurring_rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [userId, rule.account_id, rule.category_id, rule.amount, rule.type, rule.next_date, rule.note, rule.id]
        )

        const sign = rule.type === 'income' ? 1 : -1
        await fastify.db.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [rule.amount * sign, rule.account_id, userId]
        )

        const interval = frequencyToInterval(rule.frequency)
        await fastify.db.query(
          `UPDATE recurring_rules SET next_date = next_date + INTERVAL '${interval}' WHERE id = $1 AND user_id = $2`,
          [rule.id, userId]
        )

        fastify.log.info(`Created recurring transaction for rule ${rule.id} user ${userId}`)

        try {
          const title = t('notifications.recurring_created', {}, lang)
          const message = t('notifications.recurring_created_body', { name: rule.note || rule.type, amount: rule.amount, currency: '' }, lang)
          await notify(fastify, userId, {
            type: 'recurring_created', title, message,
            data: { entity_id: rule.id, url: '/transactions' },
            channels: ['bell', 'push', 'shoutrrr']
          })
        } catch (notifErr) {
          fastify.log.warn(notifErr, 'Recurring notification failed')
        }
      }
    }
  })

  // Run daily at 09:00 — debt due date check
  schedule('0 9 * * *', async () => {
    fastify.log.info('Running debt due date check')
    const usersRes = await fastify.db.query('SELECT id FROM users ORDER BY id')
    for (const user of usersRes.rows) {
      const userId = user.id
      const lang = await getUserLang(fastify.db, userId)
      const result = await fastify.db.query(
        `SELECT id, name, counterparty, due_date, type
         FROM debts
         WHERE status != 'paid' AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + INTERVAL '3 days' AND user_id = $1`,
        [userId]
      )

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
    }
  })

  // Daily cleanup of expired refresh tokens
  schedule('0 3 * * *', async () => {
    fastify.log.info('Cleaning up expired refresh tokens')
    const { rowCount } = await fastify.db.query('DELETE FROM refresh_tokens WHERE expires_at <= NOW()')
    fastify.log.info(`Deleted ${rowCount} expired refresh tokens`)
  })

  // Daily cleanup of old exchange rates (keep last 30 days)
  schedule('30 3 * * *', async () => {
    fastify.log.info('Cleaning up old exchange rates')
    const { rowCount } = await fastify.db.query("DELETE FROM exchange_rates WHERE updated_at < NOW() - INTERVAL '30 days'")
    fastify.log.info(`Deleted ${rowCount} old exchange rates`)
  })
}

export default fp(cronPlugin, { name: 'cron' })
