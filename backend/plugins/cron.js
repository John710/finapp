import fp from 'fastify-plugin'
import cron from 'node-cron'
import { t, getUserLang } from '../services/i18n.js'
import { notify, checkDuplicateNotification } from '../services/notify.js'
import { ruleColumns } from '../services/recurring-schedule.js'
import { bookDueRules } from '../services/recurring-run.js'

function amountText(amount) {
  const value = Number(amount)
  return Number.isFinite(value) ? String(value) : String(amount)
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
  schedule('0 * * * *', async () => {
    fastify.log.info('Running recurring transactions check')
    const usersRes = await fastify.db.query('SELECT id FROM users ORDER BY id')
    for (const user of usersRes.rows) {
      const userId = user.id
      // bookDueRules catches per rule; this guard keeps one user's failure
      // (e.g. their language lookup) from skipping every user after them.
      try {
        const lang = await getUserLang(fastify.db, userId)
        const events = await bookDueRules(fastify.db, fastify.log, userId)

        // Notifications (network I/O) strictly after COMMIT and client release
        for (const event of events) {
          try {
            if (event.kind === 'created') {
              const { rule, createdCount } = event
              const params = { name: rule.note || rule.type, amount: amountText(rule.amount), currency: rule.currency }
              const message = t(
                createdCount > 1 ? 'notifications.recurring_created_multi_body' : 'notifications.recurring_created_body',
                createdCount > 1 ? { ...params, count: createdCount } : params,
                lang
              )
              await notify(fastify, userId, {
                type: 'recurring_created', title: t('notifications.recurring_created', {}, lang), message,
                data: { entity_id: rule.id, url: '/transactions' },
                channels: ['bell', 'push', 'shoutrrr']
              })
            } else {
              const { rule } = event
              await notify(fastify, userId, {
                type: 'recurring_finished',
                title: t('notifications.recurring_finished', {}, lang),
                message: t('notifications.recurring_finished_body', { name: rule.note || rule.type }, lang),
                data: { entity_id: rule.id, url: '/recurring' },
                channels: ['bell', 'push', 'shoutrrr']
              })
            }
          } catch (notifErr) {
            fastify.log.warn(notifErr, 'Recurring notification failed')
          }
        }
      } catch (err) {
        fastify.log.error(err, `Recurring transactions check failed for user ${userId}`)
      }
    }
  })

  // Run daily at 08:00 — upcoming payment reminders for rules that ask for them
  schedule('0 8 * * *', async () => {
    fastify.log.info('Running recurring due date check')
    const usersRes = await fastify.db.query('SELECT id FROM users ORDER BY id')
    for (const user of usersRes.rows) {
      const userId = user.id
      const lang = await getUserLang(fastify.db, userId)
      const { rows } = await fastify.db.query(
        `SELECT ${ruleColumns('r.')} FROM recurring_rules r
         WHERE r.user_id = $1 AND r.is_active = true AND r.notify_days_before > 0
           AND r.next_date = CURRENT_DATE + make_interval(days => r.notify_days_before)`,
        [userId]
      )
      for (const rule of rows) {
        const dup = await checkDuplicateNotification(fastify, { userId, type: 'recurring_due_soon', entityId: rule.id, hours: 24 })
        if (dup) continue
        await notify(fastify, userId, {
          type: 'recurring_due_soon',
          title: t('notifications.recurring_due_soon', {}, lang),
          message: t('notifications.recurring_due_soon_body', {
            name: rule.note || rule.type, amount: amountText(rule.amount), currency: rule.currency, date: rule.next_date
          }, lang),
          data: { entity_id: rule.id, url: '/recurring' },
          channels: ['bell', 'push', 'shoutrrr']
        })
      }
    }
  })

  // Run daily at 09:30 — occurrences the ledger still does not have
  schedule('30 9 * * *', async () => {
    fastify.log.info('Running recurring overdue check')
    const usersRes = await fastify.db.query('SELECT id FROM users ORDER BY id')
    for (const user of usersRes.rows) {
      const userId = user.id
      const lang = await getUserLang(fastify.db, userId)
      const { rows } = await fastify.db.query(
        `SELECT ${ruleColumns('r.')} FROM recurring_rules r
         WHERE r.user_id = $1 AND r.is_active = true AND r.next_date < CURRENT_DATE
           AND NOT EXISTS (SELECT 1 FROM transactions tx
                           WHERE tx.recurring_rule_id = r.id AND tx.date = r.next_date)
           AND NOT EXISTS (SELECT 1 FROM recurring_exceptions ex
                           WHERE ex.rule_id = r.id AND ex.occurrence_date = r.next_date AND ex.kind = 'skipped')`,
        [userId]
      )
      for (const rule of rows) {
        const dup = await checkDuplicateNotification(fastify, { userId, type: 'recurring_overdue', entityId: rule.id, hours: 24 })
        if (dup) continue
        await notify(fastify, userId, {
          type: 'recurring_overdue',
          title: t('notifications.recurring_overdue', {}, lang),
          message: t('notifications.recurring_overdue_body', {
            name: rule.note || rule.type, amount: amountText(rule.amount), currency: rule.currency, date: rule.next_date
          }, lang),
          data: { entity_id: rule.id, url: '/recurring' },
          channels: ['bell', 'push', 'shoutrrr']
        })
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
