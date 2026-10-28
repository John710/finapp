import Decimal from 'decimal.js'
import { planRuleRun, ruleColumns } from './recurring-schedule.js'

// numeric(24,12) reaches us as a string — move it in Decimal, never through a float.
function signedAmount(amount, type) {
  return new Decimal(amount).times(type === 'income' ? 1 : -1).toString()
}

/**
 * Write the occurrences a rule owes up to `today`. The caller owns the
 * transaction and the FOR UPDATE lock on the rule row, so a half-applied rule
 * rolls back as a unit; this helper only writes and reports what it did.
 */
export async function generateOccurrences(client, rule, today, options = {}) {
  const { rows: paidRows } = await client.query(
    'SELECT date::text AS date FROM transactions WHERE recurring_rule_id = $1',
    [rule.id]
  )
  const { rows: skipRows } = await client.query(
    "SELECT occurrence_date::text AS date FROM recurring_exceptions WHERE rule_id = $1 AND kind = 'skipped'",
    [rule.id]
  )
  const plan = planRuleRun(rule, today, {
    paid: new Set(paidRows.map(r => r.date)),
    skipped: new Set(skipRows.map(r => r.date)),
    ...(options.limit === undefined ? {} : { limit: options.limit })
  })

  const created = []
  const conflicted = []
  for (const date of plan.toCreate) {
    const inserted = await client.query(
      `INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, recurring_rule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [rule.user_id, rule.account_id, rule.category_id, rule.amount, rule.type, date, rule.note, rule.id]
    )
    // The date is already in the ledger — a re-run, or a payment entered by hand.
    if (inserted.rows.length === 0) {
      conflicted.push(date)
      continue
    }
    created.push(date)
    await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
      signedAmount(rule.amount, rule.type), rule.account_id, rule.user_id
    ])
  }
  for (const date of plan.rewound) {
    await client.query(
      'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
      [rule.id, rule.user_id, 'skipped', null, JSON.stringify({ date, reason: 'catch_up_limit' }), date]
    )
  }

  const cursorMoved = plan.nextDate !== rule.next_date
  if (created.length > 0 || plan.rewound.length > 0 || plan.finished || cursorMoved) {
    await client.query(
      `UPDATE recurring_rules
       SET next_date = COALESCE($1, next_date), occurrences_paid = occurrences_paid + $2,
           last_run_date = COALESCE($3, last_run_date), is_active = $4, updated_at = now()
       WHERE id = $5`,
      [plan.nextDate, created.length, plan.lastDate, !plan.finished, rule.id]
    )
  }
  if (plan.finished) {
    await client.query(
      'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
      [rule.id, rule.user_id, 'ended', JSON.stringify({ is_active: true }), JSON.stringify({ is_active: false, last_date: plan.lastDate }), plan.lastDate]
    )
  }

  return {
    created,
    createdCount: created.length,
    conflicted,
    rewound: plan.rewound,
    nextDate: plan.nextDate,
    lastDate: plan.lastDate,
    finished: plan.finished
  }
}

/**
 * Book every rule of one user that is due, one rule per transaction. Returns
 * the events the caller should notify about once all clients are released.
 *
 * "Due" and "today" both come from the database clock: the rule is selected by
 * `next_date <= CURRENT_DATE`, so the date it is booked up to has to be that
 * same CURRENT_DATE — the container runs Asia/Vladivostok while PostgreSQL runs
 * UTC, and a Node-side "today" one day behind would select a rule, owe it
 * nothing and select it again forever. A rule whose state did not move, or
 * whose booking failed, is set aside for the rest of the run so it can neither
 * spin the loop nor stop the user's other rules.
 */
export async function bookDueRules(db, log, userId) {
  const events = []
  const setAside = []
  while (true) {
    const client = await db.connect()
    let rule = null
    try {
      await client.query('BEGIN')
      const { rows: [{ today }] } = await client.query('SELECT CURRENT_DATE::text AS today')
      const ruleRes = await client.query(
        `SELECT ${ruleColumns('')} FROM recurring_rules
         WHERE is_active = true AND next_date <= CURRENT_DATE AND user_id = $1
           AND NOT (id = ANY($2::int[]))
         ORDER BY next_date, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [userId, setAside]
      )
      if (ruleRes.rows.length === 0) {
        await client.query('COMMIT')
        break
      }
      rule = ruleRes.rows[0]

      // Which dates exist at all, and which of them the ledger still owes, is
      // decided by the schedule service — no date arithmetic in SQL, so a
      // 31st-of-the-month anchor cannot ratchet.
      const outcome = await generateOccurrences(client, rule, today)
      await client.query('COMMIT')

      const advanced = outcome.createdCount > 0 || outcome.rewound.length > 0 || outcome.finished ||
        outcome.nextDate !== rule.next_date
      if (!advanced) {
        setAside.push(rule.id)
        log.warn(`Recurring rule ${rule.id} is due but owed nothing up to ${today}; leaving it for the next run`)
      }
      if (outcome.createdCount > 0) {
        events.push({ kind: 'created', rule, createdCount: outcome.createdCount })
        log.info(`Created ${outcome.createdCount} recurring transaction(s) for rule ${rule.id} user ${userId}`)
      }
      if (outcome.finished) events.push({ kind: 'finished', rule })
      if (outcome.rewound.length > 0) {
        log.warn(`Rewound ${outcome.rewound.length} overdue occurrence(s) for rule ${rule.id} past the catch-up limit`)
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      // Without a rule there is nothing to set aside: the selection itself
      // failed and retrying it in this run would fail the same way.
      if (!rule) {
        log.error(err, `Recurring run failed for user ${userId}`)
        break
      }
      setAside.push(rule.id)
      log.error(err, `Recurring rule ${rule.id} of user ${userId} failed; continuing with the next rule`)
    } finally {
      client.release()
    }
  }
  return events
}
