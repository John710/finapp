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

// node-pg parses DATE columns as local midnight Dates; keep the calendar day
// in local components so timezone offsets cannot shift it by one day.
function dateKey(d) {
  if (typeof d === 'string') return d.slice(0, 10)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
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

  // Run every hour — recurring transactions.
  // Each rule is processed inside one transaction with FOR UPDATE SKIP LOCKED:
  // a crash mid-rule rolls back cleanly (no duplicate transactions), and two
  // app instances can never process the same rule concurrently. A rule that
  // fell behind catches up immediately (bounded), instead of one occurrence
  // per hourly run for weeks.
  const RECURRING_CATCHUP_LIMIT = 10

  schedule('0 * * * *', async () => {
    fastify.log.info('Running recurring transactions check')
    const usersRes = await fastify.db.query('SELECT id FROM users ORDER BY id')
    for (const user of usersRes.rows) {
      const userId = user.id
      const lang = await getUserLang(fastify.db, userId)

      while (true) {
        const todayKey = dateKey(new Date())
        const client = await fastify.db.connect()
        let notifRule = null
        let createdCount = 0
        try {
          await client.query('BEGIN')
          const ruleRes = await client.query(
            `SELECT * FROM recurring_rules
             WHERE is_active = true AND next_date <= CURRENT_DATE AND user_id = $1
             ORDER BY next_date, id
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [userId]
          )
          if (ruleRes.rows.length === 0) {
            await client.query('COMMIT')
            break
          }
          const rule = ruleRes.rows[0]
          const interval = frequencyToInterval(rule.frequency)
          const sign = rule.type === 'income' ? 1 : -1

          let nextDate = rule.next_date
          let advanced = 0
          while (dateKey(nextDate) <= todayKey && createdCount < RECURRING_CATCHUP_LIMIT) {
            await client.query(
              'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, recurring_rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
              [userId, rule.account_id, rule.category_id, rule.amount, rule.type, dateKey(nextDate), rule.note, rule.id]
            )
            await client.query(
              'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
              [rule.amount * sign, rule.account_id, userId]
            )
            createdCount++
            const adv = await client.query(
              `UPDATE recurring_rules SET next_date = next_date + INTERVAL '${interval}' WHERE id = $1 RETURNING next_date`,
              [rule.id]
            )
            nextDate = adv.rows[0].next_date
            advanced++
          }
          // Catch-up cap reached but the rule is still due (e.g. inactive for a
          // very long time): jump to the next future occurrence instead of
          // flooding the ledger with historical entries.
          while (dateKey(nextDate) <= todayKey) {
            const adv = await client.query(
              `UPDATE recurring_rules SET next_date = next_date + INTERVAL '${interval}' WHERE id = $1 RETURNING next_date`,
              [rule.id]
            )
            nextDate = adv.rows[0].next_date
            advanced++
            if (advanced > 100000) throw new Error('recurring next_date advancement exceeded safety limit')
          }

          await client.query('COMMIT')
          if (createdCount > 0) {
            notifRule = { rule, createdCount }
            fastify.log.info(`Created ${createdCount} recurring transaction(s) for rule ${rule.id} user ${userId}`)
          }
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        } finally {
          client.release()
        }

        // Notifications (network I/O) strictly after COMMIT and client release
        if (notifRule) {
          try {
            const { rule, createdCount } = notifRule
            // rule.amount is a numeric string from pg — trim the trailing
            // zeroes instead of pushing the raw "1500.000000000000" into the message
            const amountNum = Number(rule.amount)
            const amountText = Number.isFinite(amountNum) ? String(amountNum) : String(rule.amount)
            const title = t('notifications.recurring_created', {}, lang)
            const message = t('notifications.recurring_created_body', { name: rule.note || rule.type, amount: amountText, currency: createdCount > 1 ? `×${createdCount}` : '' }, lang)
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
