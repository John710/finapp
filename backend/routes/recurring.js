import Decimal from 'decimal.js'
import crypto from 'node:crypto'
import { t, getUserLang, getReqLang } from '../services/i18n.js'
import { loadOccurrenceFlags, loadRule, loadVisibleRules } from '../services/recurring-rules.js'
import { buildFeed } from '../services/ical.js'
import { loadInstallmentOccurrences } from '../services/debt-payments.js'
import { currencyDigits } from '../services/debt-schedule.js'
import { visibleAccountIds } from '../services/visibility.js'
import {
  nextOccurrenceAfter,
  occurrenceAllowed,
  statusOf,
  monthlyEquivalent,
  dueOccurrence,
  projectOccurrences,
  mergeOccurrences,
  toLegacyFrequency,
  initialNextDate,
  resolveProjectionWindow,
  buildSchedulePatch,
  frequencyToSchedule,
  shiftDays,
  ruleColumns,
  PATCHABLE_COLUMNS
} from '../services/recurring-schedule.js'

const SCHEDULE_COLUMNS = new Set([
  'interval_unit', 'interval_value', 'billing_anchor_day', 'start_date', 'end_date',
  'cancellation_date', 'auto_renew', 'payment_limit'
])

// How far ahead a calendar client may look. Long enough for a yearly bill to
// show up, short enough that the feed stays a projection and not a history.
const FEED_WINDOW_DAYS = 180

const PROJECTION_RATE_LIMIT = {
  config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: req => req.user?.userId ?? req.ip } }
}

function dayPart(dateStr) {
  return Number(dateStr.slice(8, 10))
}

function signedAmount(amount, type) {
  const sign = type === 'income' ? 1 : -1
  return new Decimal(amount).times(sign).toString()
}

function pick(row, columns) {
  const out = {}
  for (const column of columns) if (column in row) out[column] = row[column] ?? null
  return out
}

async function recurringRoutes(fastify, opts) {
  async function serverToday() {
    const { rows } = await fastify.db.query('SELECT CURRENT_DATE::text AS today')
    return rows[0]?.today ?? null
  }

  function upcoming(rule, today, paidSet, skipSet) {
    let date = nextOccurrenceAfter(rule, today)
    for (let guard = 0; guard < 500 && date && (paidSet.has(date) || skipSet.has(date)); guard++) {
      date = nextOccurrenceAfter(rule, date)
    }
    return date
  }

  function enrich(rule, today, paidSet, skipSet) {
    return {
      ...rule,
      status: statusOf(rule, today, paidSet, skipSet),
      // Shown at the currency's own precision: 2 for USD, 8 for a crypto
      // ticker, so a small crypto rule is not printed as 0.00.
      monthly_equivalent: new Decimal(monthlyEquivalent(rule)).toFixed(currencyDigits(rule.currency)),
      // The occurrence pay/skip/run-now act on — overdue rules point backwards
      // from today here, while next_occurrence always looks forwards.
      due_date: dueOccurrence(rule, today, paidSet, skipSet),
      next_occurrence: upcoming(rule, today, paidSet, skipSet)
    }
  }

  // Every booking path (cron, pay, run-now) moves the account balance by the
  // rule's amount as-is, so a rule's currency has to be its account's currency;
  // anything else would debit 10 RUB for a "10 USD" rule.
  async function ensureAccount(userId, accountId, currency, lang, reply) {
    const { rows } = await fastify.db.query('SELECT id, currency FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId])
    if (rows.length === 0) {
      reply.code(404)
      return { error: t('errors.account_not_found', {}, lang) }
    }
    const account = rows[0]
    if (currency != null && currency !== account.currency) {
      reply.code(400)
      return { error: t('errors.rule_currency_mismatch', { currency: account.currency }, lang) }
    }
    return { account }
  }

  async function ensureCategory(categoryId, lang, reply) {
    if (!categoryId) return null
    const { rows } = await fastify.db.query('SELECT id FROM categories WHERE id = $1', [categoryId])
    if (rows.length === 0) {
      reply.code(404)
      return { error: t('errors.category_not_found', {}, lang) }
    }
    return null
  }

  // List
  fastify.get('/recurring', PROJECTION_RATE_LIMIT, async (request, reply) => {
    const userId = request.user.userId
    const rules = await loadVisibleRules(fastify.db, userId)
    const today = await serverToday()
    const { paid, skipped } = await loadOccurrenceFlags(fastify.db, rules.map(r => r.id))
    return rules.map(rule => enrich(rule, today, paid.get(rule.id) ?? new Set(), skipped.get(rule.id) ?? new Set()))
  })

  // Projection: what the schedule will ask for between two dates
  fastify.get('/recurring/occurrences', {
    ...PROJECTION_RATE_LIMIT,
    schema: {
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const window = resolveProjectionWindow(request.query.from, request.query.to)
    if (!window.ok) {
      reply.code(400)
      return { error: t(`errors.${window.error}`, {}, lang) }
    }
    const [rules, installments] = await Promise.all([
      loadVisibleRules(fastify.db, userId, { order: 'r.id ASC' }),
      loadInstallmentOccurrences(fastify.db, userId, window.from, window.to)
    ])
    const flags = await loadOccurrenceFlags(fastify.db, rules.map(r => r.id))
    const occurrences = mergeOccurrences(projectOccurrences(rules, flags, window.from, window.to), installments)
    return { from: window.from, to: window.to, occurrences }
  })

  // Create
  fastify.post('/recurring', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id', 'amount', 'type'],
        anyOf: [{ required: ['frequency'] }, { required: ['interval_unit'] }],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: ['integer', 'null'] },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          currency: { type: 'string', maxLength: 10 },
          type: { type: 'string', enum: ['income', 'expense'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          interval_unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
          interval_value: { type: 'integer', minimum: 1, maximum: 100 },
          billing_anchor_day: { type: ['integer', 'null'], minimum: 1, maximum: 31 },
          start_date: { type: ['string', 'null'], format: 'date' },
          end_date: { type: ['string', 'null'], format: 'date' },
          cancellation_date: { type: ['string', 'null'], format: 'date' },
          auto_renew: { type: 'boolean' },
          payment_limit: { type: ['integer', 'null'], minimum: 1 },
          notify_days_before: { type: 'integer', minimum: 0, maximum: 90 },
          next_date: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const body = request.body
    const accountCheck = await ensureAccount(userId, body.account_id, body.currency, lang, reply)
    if (accountCheck.error) return accountCheck
    const { account } = accountCheck
    const categoryError = await ensureCategory(body.category_id, lang, reply)
    if (categoryError) return categoryError

    const legacy = frequencyToSchedule(body.frequency)
    const unit = body.interval_unit ?? legacy?.unit ?? 'month'
    const value = body.interval_value ?? legacy?.value ?? 1
    const today = await serverToday()
    const startDate = body.start_date ?? body.next_date ?? today
    const rule = {
      interval_unit: unit,
      interval_value: value,
      billing_anchor_day: body.billing_anchor_day ?? (startDate ? dayPart(startDate) : null),
      start_date: startDate,
      end_date: body.end_date ?? null,
      cancellation_date: body.cancellation_date ?? null,
      auto_renew: body.auto_renew !== false,
      payment_limit: body.payment_limit ?? null,
      is_active: true
    }
    const nextDate = body.next_date ?? initialNextDate(rule, today)
    if (!nextDate) {
      reply.code(400)
      return { error: t('errors.schedule_never_occurs', {}, lang) }
    }

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `INSERT INTO recurring_rules (user_id, account_id, category_id, amount, currency, type, frequency,
           next_date, note, interval_unit, interval_value, billing_anchor_day, start_date, end_date,
           cancellation_date, auto_renew, payment_limit, notify_days_before)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING ${ruleColumns('')}`,
        [
          userId, body.account_id, body.category_id ?? null, body.amount, account.currency, body.type,
          toLegacyFrequency(unit, value), nextDate, body.note ?? null, unit, value,
          rule.billing_anchor_day, startDate, rule.end_date, rule.cancellation_date, rule.auto_renew,
          rule.payment_limit, body.notify_days_before ?? 0
        ]
      )
      const created = rows[0]
      await client.query(
        'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
        [created.id, userId, 'created', null, JSON.stringify(pick(created, ['amount', 'currency', 'type', 'interval_unit', 'interval_value', 'billing_anchor_day', 'start_date', 'next_date'])), created.start_date]
      )
      await client.query('COMMIT')
      reply.code(201)
      return created
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  async function applyRuleUpdate(request, reply, { deprecated = false } = {}) {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const id = request.params.id
    const body = request.body

    const rule = await loadRule(fastify.db, userId, id)
    if (!rule) {
      reply.code(404)
      return { error: t('errors.rule_not_found', {}, lang) }
    }
    if (rule.user_id !== userId) {
      reply.code(403)
      return { error: t('errors.rule_not_editable', {}, lang) }
    }

    const { fields, values, empty } = buildSchedulePatch(body)
    if (empty && !deprecated) {
      reply.code(400)
      return { error: t('errors.no_fields_to_update', {}, lang) }
    }
    // Only a request that touches the account or the currency is held to the
    // match, so pausing or renaming a rule saved before the check keeps working.
    if (body.account_id !== undefined || body.currency !== undefined) {
      const accountCheck = await ensureAccount(
        userId, body.account_id ?? rule.account_id, body.currency ?? rule.currency, lang, reply
      )
      if (accountCheck.error) return accountCheck
    }
    const categoryError = await ensureCategory(body.category_id, lang, reply)
    if (categoryError) return categoryError

    const changed = {}
    for (const column of PATCHABLE_COLUMNS) {
      if (body[column] !== undefined) changed[column] = body[column]
    }
    const merged = { ...rule, ...changed }
    const scheduleTouched = Object.keys(changed).some(column => SCHEDULE_COLUMNS.has(column))
    if (deprecated && body.frequency) {
      const legacy = frequencyToSchedule(body.frequency)
      if (legacy) {
        merged.interval_unit = legacy.unit
        merged.interval_value = legacy.value
      }
    }
    const today = await serverToday()

    const assignments = [...fields]
    const params = [...values]
    const addField = (column, value) => {
      assignments.push(`${column} = $${params.length + 1}`)
      params.push(value)
    }
    if (scheduleTouched || deprecated) addField('frequency', toLegacyFrequency(merged.interval_unit, merged.interval_value))
    if (deprecated && body.next_date) {
      addField('next_date', body.next_date)
      if (!merged.start_date) addField('start_date', body.next_date)
    } else if (scheduleTouched) {
      if (!merged.start_date) addField('start_date', merged.next_date)
      const derived = initialNextDate({ ...merged, start_date: merged.start_date ?? rule.next_date }, today)
      if (derived) addField('next_date', derived)
    }
    if (assignments.length === 0) {
      reply.code(400)
      return { error: t('errors.no_fields_to_update', {}, lang) }
    }

    const events = []
    if (changed.amount !== undefined && !new Decimal(changed.amount).equals(rule.amount)) {
      events.push({ type: 'price_changed', old: { amount: rule.amount, currency: rule.currency }, new: { amount: String(changed.amount), currency: merged.currency } })
    }
    if (changed.currency !== undefined && changed.currency !== rule.currency) {
      events.push({ type: 'currency_changed', old: { currency: rule.currency }, new: { currency: changed.currency } })
    }
    if (scheduleTouched) {
      events.push({ type: 'schedule_changed', old: pick(rule, SCHEDULE_COLUMNS), new: pick(merged, SCHEDULE_COLUMNS) })
    }
    if (changed.is_active !== undefined && changed.is_active !== rule.is_active) {
      events.push({ type: changed.is_active ? 'resumed' : 'paused', old: { is_active: rule.is_active }, new: { is_active: changed.is_active } })
    }

    if (deprecated) reply.header('Deprecation', 'true')
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `UPDATE recurring_rules SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $${params.length + 1} AND user_id = $${params.length + 2}
         RETURNING ${ruleColumns('')}`,
        [...params, id, userId]
      )
      const updated = rows[0]
      if (!updated) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.rule_not_found', {}, lang) }
      }
      for (const event of events) {
        await client.query(
          'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, userId, event.type, JSON.stringify(event.old ?? null), JSON.stringify(event.new ?? null), updated.next_date]
        )
      }
      await client.query('COMMIT')
      return updated
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  const ruleParams = {
    params: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer', minimum: 1 } }
    }
  }

  const patchBody = {
    type: 'object',
    properties: {
      account_id: { type: 'integer' },
      category_id: { type: ['integer', 'null'] },
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
      currency: { type: 'string', maxLength: 10 },
      type: { type: 'string', enum: ['income', 'expense'] },
      note: { type: ['string', 'null'], maxLength: 1000 },
      is_active: { type: 'boolean' },
      interval_unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
      interval_value: { type: 'integer', minimum: 1, maximum: 100 },
      billing_anchor_day: { type: ['integer', 'null'], minimum: 1, maximum: 31 },
      start_date: { type: ['string', 'null'], format: 'date' },
      end_date: { type: ['string', 'null'], format: 'date' },
      cancellation_date: { type: ['string', 'null'], format: 'date' },
      auto_renew: { type: 'boolean' },
      payment_limit: { type: ['integer', 'null'], minimum: 1 },
      notify_days_before: { type: 'integer', minimum: 0, maximum: 90 }
    }
  }

  // Partial update — only the columns the client actually sent are bound
  fastify.patch('/recurring/:id', { schema: { ...ruleParams, body: patchBody } }, applyRuleUpdate)

  // Kept for one release: the SPA still PUTs the whole row.
  fastify.put('/recurring/:id', {
    schema: {
      ...ruleParams,
      body: {
        ...patchBody,
        required: ['account_id', 'amount', 'type'],
        anyOf: [{ required: ['frequency'] }, { required: ['interval_unit'] }],
        properties: {
          ...patchBody.properties,
          frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          next_date: { type: 'string', format: 'date' }
        }
      }
    }
  }, (request, reply) => applyRuleUpdate(request, reply, { deprecated: true }))

  // Delete
  fastify.delete('/recurring/:id', { schema: ruleParams }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const { id } = request.params
    // The owned delete decides; the shares go only once it removed a row, and
    // only the owner's own shares — never another user's rows on a guessed id.
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query('DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId])
      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(404)
        return { error: t('errors.rule_not_found', {}, lang) }
      }
      await client.query(
        "DELETE FROM entity_shares WHERE entity_type = 'recurring' AND entity_id = $1 AND owner_id = $2",
        [id, userId]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    reply.code(204)
  })

  async function ownedRule(request, reply) {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const id = request.params.id ?? request.body.rule_id
    const rule = await loadRule(fastify.db, userId, id)
    if (!rule) {
      reply.code(404)
      return { error: t('errors.rule_not_found', {}, lang) }
    }
    if (rule.user_id !== userId) {
      reply.code(403)
      return { error: t('errors.rule_not_editable', {}, lang) }
    }
    return { rule, userId, lang }
  }

  // Pay one scheduled occurrence
  fastify.post('/recurring/occurrences/pay', {
    schema: {
      body: {
        type: 'object',
        required: ['rule_id', 'date'],
        properties: {
          rule_id: { type: 'integer', minimum: 1 },
          date: { type: 'string', format: 'date' },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12 },
          note: { type: 'string', maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const owned = await ownedRule(request, reply)
    if (owned.error) return owned
    const { rule, userId, lang } = owned
    const { date, amount, note } = request.body
    if (!occurrenceAllowed(rule, date)) {
      reply.code(400)
      return { error: t('errors.occurrence_not_scheduled', {}, lang) }
    }
    const { paid } = await loadOccurrenceFlags(fastify.db, [rule.id])
    if (paid.get(rule.id)?.has(date)) {
      reply.code(400)
      return { error: t('errors.occurrence_already_paid', {}, lang) }
    }
    const value = amount ?? rule.amount
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, recurring_rule_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [rule.user_id, rule.account_id, rule.category_id, value, rule.type, date, note ?? rule.note, rule.id]
      )
      if (rows.length === 0) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.occurrence_already_paid', {}, lang) }
      }
      await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
        signedAmount(value, rule.type), rule.account_id, rule.user_id
      ])
      await client.query(
        'UPDATE recurring_rules SET occurrences_paid = occurrences_paid + 1, last_run_date = $1, updated_at = now() WHERE id = $2',
        [date, rule.id]
      )
      await client.query(
        'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
        [rule.id, userId, 'paid', null, JSON.stringify({ date, amount: String(value) }), date]
      )
      await client.query('COMMIT')
      reply.code(201)
      return { transaction_id: rows[0].id, date, amount: String(value) }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Undo a payment the schedule made
  fastify.delete('/recurring/occurrences/pay', {
    schema: {
      body: {
        type: 'object',
        required: ['rule_id', 'date'],
        properties: {
          rule_id: { type: 'integer', minimum: 1 },
          date: { type: 'string', format: 'date' }
        }
      }
    }
  }, async (request, reply) => {
    const owned = await ownedRule(request, reply)
    if (owned.error) return owned
    const { rule, lang } = owned
    const { date } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      // The DELETE is the check: of two concurrent undos only one gets the row
      // back, so the balance is reverted exactly once.
      const { rows } = await client.query(
        `DELETE FROM transactions WHERE recurring_rule_id = $1 AND date = $2
         RETURNING id, account_id, amount::text AS amount, type`,
        [rule.id, date]
      )
      const tx = rows[0]
      if (!tx) {
        await client.query('ROLLBACK')
        reply.code(400)
        return { error: t('errors.occurrence_not_paid', {}, lang) }
      }
      await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
        new Decimal(signedAmount(tx.amount, tx.type)).negated().toString(), tx.account_id, rule.user_id
      ])
      await client.query(
        'UPDATE recurring_rules SET occurrences_paid = occurrences_paid - 1, last_run_date = NULL, updated_at = now() WHERE id = $1 AND occurrences_paid > 0',
        [rule.id]
      )
      await client.query('COMMIT')
      return { success: true, transaction_id: tx.id, date }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Skip an occurrence without touching the ledger
  fastify.post('/recurring/occurrences/skip', {
    schema: {
      body: {
        type: 'object',
        required: ['rule_id', 'date'],
        properties: {
          rule_id: { type: 'integer', minimum: 1 },
          date: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const owned = await ownedRule(request, reply)
    if (owned.error) return owned
    const { rule, userId, lang } = owned
    const { date, note } = request.body
    if (!occurrenceAllowed(rule, date)) {
      reply.code(400)
      return { error: t('errors.occurrence_not_scheduled', {}, lang) }
    }
    const { paid } = await loadOccurrenceFlags(fastify.db, [rule.id])
    if (paid.get(rule.id)?.has(date)) {
      reply.code(400)
      return { error: t('errors.occurrence_already_paid', {}, lang) }
    }
    const { rows } = await fastify.db.query(
      `INSERT INTO recurring_exceptions (rule_id, occurrence_date, kind, note)
       VALUES ($1, $2, 'skipped', $3)
       ON CONFLICT (rule_id, occurrence_date) DO NOTHING
       RETURNING id`,
      [rule.id, date, note ?? null]
    )
    await fastify.db.query(
      'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
      [rule.id, userId, 'skipped', null, JSON.stringify({ date }), date]
    )
    reply.code(201)
    return { success: true, rule_id: rule.id, date, skipped: rows.length > 0 }
  })

  fastify.delete('/recurring/occurrences/skip', {
    schema: {
      body: {
        type: 'object',
        required: ['rule_id', 'date'],
        properties: {
          rule_id: { type: 'integer', minimum: 1 },
          date: { type: 'string', format: 'date' }
        }
      }
    }
  }, async (request, reply) => {
    const owned = await ownedRule(request, reply)
    if (owned.error) return owned
    const { rule } = owned
    const result = await fastify.db.query(
      "DELETE FROM recurring_exceptions WHERE rule_id = $1 AND occurrence_date = $2 AND kind = 'skipped'",
      [rule.id, request.body.date]
    )
    return { success: true, deleted: result.rowCount > 0 }
  })

  // Generate the occurrence the schedule is sitting on, right now
  fastify.post('/recurring/:id/run-now', { schema: ruleParams }, async (request, reply) => {
    const owned = await ownedRule(request, reply)
    if (owned.error) return owned
    const { rule, userId, lang } = owned
    const today = await serverToday()
    const { paid, skipped } = await loadOccurrenceFlags(fastify.db, [rule.id])
    const cursor = dueOccurrence(rule, today, paid.get(rule.id) ?? new Set(), skipped.get(rule.id) ?? new Set())
    if (!cursor) {
      reply.code(400)
      return { error: t('errors.schedule_never_occurs', {}, lang) }
    }
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note, recurring_rule_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [rule.user_id, rule.account_id, rule.category_id, rule.amount, rule.type, cursor, rule.note, rule.id]
      )
      if (rows.length === 0) {
        await client.query('COMMIT')
        const existing = await fastify.db.query(
          'SELECT id FROM transactions WHERE recurring_rule_id = $1 AND date = $2',
          [rule.id, cursor]
        )
        return { occurrence: cursor, transaction_id: existing.rows[0]?.id ?? null, created: false }
      }
      await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
        signedAmount(rule.amount, rule.type), rule.account_id, rule.user_id
      ])
      await client.query(
        'UPDATE recurring_rules SET occurrences_paid = occurrences_paid + 1, last_run_date = $1, next_date = $2, updated_at = now() WHERE id = $3',
        [cursor, nextOccurrenceAfter(rule, cursor) ?? rule.next_date, rule.id]
      )
      await client.query(
        'INSERT INTO recurring_history (rule_id, user_id, event_type, old_value, new_value, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
        [rule.id, userId, 'paid', null, JSON.stringify({ date: cursor, amount: rule.amount, run_now: true }), cursor]
      )
      await client.query('COMMIT')
      return { occurrence: cursor, transaction_id: rows[0].id, created: true }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // History
  fastify.get('/recurring/:id/history', {
    ...PROJECTION_RATE_LIMIT,
    schema: {
      ...ruleParams,
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    const rule = await loadRule(fastify.db, userId, request.params.id)
    if (!rule) {
      reply.code(404)
      return { error: t('errors.rule_not_found', {}, lang) }
    }
    const limit = request.query.limit ?? 200
    // h.id and h.created_at both collide with the joined users row, so every
    // history column has to be qualified.
    const { rows } = await fastify.db.query(
      `SELECT h.id, h.event_type, h.old_value, h.new_value, h.effective_date::text AS effective_date,
              h.created_at, h.user_id AS actor_id, u.login AS actor_login
       FROM recurring_history h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.rule_id = $1
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT $2`,
      [rule.id, limit]
    )
    return rows
  })

  // Calendar feed. The token is a credential that a calendar client can only
  // carry in the URL, so the route is declared public (the auth hook would
  // otherwise log the full URL with the token) and returns no body a client
  // could cache. Digest lookup mirrors routes/tokens.js: the plaintext is never
  // stored, only shown once at creation.
  // The feed's debt installments, each with its debt's account name when the
  // feed owner can see that account: a debt shared by family does not reveal
  // the owner's account names (the rule GET /debts follows).
  async function feedInstallments(userId, from, to) {
    const installments = await loadInstallmentOccurrences(fastify.db, userId, from, to)
    if (installments.length === 0) return installments
    const visible = await visibleAccountIds(fastify.db, userId)
    const { rows } = await fastify.db.query(
      `SELECT d.id AS debt_id, a.name AS account_name
       FROM debts d JOIN accounts a ON a.id = d.account_id
       WHERE d.id = ANY($1::int[]) AND a.id = ANY($2::int[])`,
      [[...new Set(installments.map(row => row.debt_id))], visible]
    )
    const names = new Map(rows.map(row => [row.debt_id, row.account_name]))
    return installments.map(row => ({ ...row, account_name: names.get(row.debt_id) ?? null }))
  }

  const FEED_RATE_LIMIT = {
    config: {
      public: true,
      // Keyed by client address: a per-token key would hand every guessed
      // token a fresh bucket and stop nothing.
      rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: req => req.ip }
    }
  }

  fastify.get('/recurring.ics', {
    ...FEED_RATE_LIMIT,
    schema: {
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 16, maxLength: 64 } }
      }
    }
  }, async (request, reply) => {
    const tokenHash = crypto.createHash('sha256').update(request.query.token).digest('hex')
    const { rows } = await fastify.db.query(
      'SELECT id, user_id FROM recurring_feed_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash]
    )
    if (rows.length === 0) {
      reply.code(401)
      return { error: t('errors.invalid_feed_token', {}, getReqLang(request)) }
    }
    const token = rows[0]
    fastify.db.query('UPDATE recurring_feed_tokens SET last_used_at = NOW() WHERE token_hash = $1', [tokenHash]).catch(() => {})

    const today = await serverToday()
    const to = shiftDays(today, FEED_WINDOW_DAYS)
    const [allRules, installments] = await Promise.all([
      loadVisibleRules(fastify.db, token.user_id),
      feedInstallments(token.user_id, today, to)
    ])
    const rules = allRules.filter(rule => rule.is_active)
    const flags = await loadOccurrenceFlags(fastify.db, rules.map(rule => rule.id))
    const occurrences = mergeOccurrences(projectOccurrences(rules, flags, today, to), installments)

    reply.header('Content-Type', 'text/calendar; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    return buildFeed(occurrences, {
      calendarName: t('feed.calendar_name', {}, getReqLang(request)),
      uidHost: 'finapp',
      generatedAt: new Date().toISOString()
    })
  })

  fastify.get('/recurring/feed-tokens', async (request) => {
    const { rows } = await fastify.db.query(
      'SELECT id, name, created_at, last_used_at, revoked_at FROM recurring_feed_tokens WHERE user_id = $1 ORDER BY created_at DESC',
      [request.user.userId]
    )
    return rows
  })

  fastify.post('/recurring/feed-tokens', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 100 } }
      }
    }
  }, async (request, reply) => {
    // A feed URL is typed and pasted, so it stays a UUID rather than 64 hex chars.
    const token = crypto.randomUUID()
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const { rows } = await fastify.db.query(
      'INSERT INTO recurring_feed_tokens (user_id, name, token_hash) VALUES ($1, $2, $3) RETURNING id, name, created_at',
      [request.user.userId, request.body.name, tokenHash]
    )
    reply.code(201)
    return { ...rows[0], token }
  })

  // Revoking keeps the row: the audit value of "this link was alive until X" is
  // worth more than the storage the row costs.
  fastify.delete('/recurring/feed-tokens/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } }
      }
    }
  }, async (request, reply) => {
    const { rowCount } = await fastify.db.query(
      'UPDATE recurring_feed_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [request.params.id, request.user.userId]
    )
    if (rowCount === 0) {
      const lang = await getUserLang(fastify.db, request.user.userId)
      reply.code(404)
      return { error: t('errors.token_not_found', {}, lang) }
    }
    reply.code(204)
  })
}

export default recurringRoutes
