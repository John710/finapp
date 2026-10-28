import { ruleColumns } from './recurring-schedule.js'

// Reads every recurring_rules query the product makes. Sharing one loader keeps
// the family-sharing scope, the `::text` date casts and the paid/skipped
// exception lookups identical for the REST routes, the dashboard and the reports.

const RULE_JOIN = `
  FROM recurring_rules r
  LEFT JOIN accounts a ON a.id = r.account_id
  LEFT JOIN categories c ON c.id = r.category_id
  JOIN users ou ON ou.id = r.user_id
  LEFT JOIN entity_shares es ON es.entity_type = 'recurring' AND es.entity_id = r.id
    AND es.owner_id = r.user_id AND (es.shared_with = $1 OR es.shared_with IS NULL)`

const RULE_SHARE_COLUMNS = `a.name AS account_name, c.name AS category_name,
  CASE WHEN r.user_id = $1 THEN NULL ELSE ou.login END AS owner_login,
  (r.user_id = $1) AS is_owner,
  CASE WHEN r.user_id = $1 THEN COALESCE((SELECT true FROM entity_shares es3
    WHERE es3.entity_type = 'recurring' AND es3.entity_id = r.id AND es3.owner_id = r.user_id LIMIT 1), false) ELSE false END AS is_shared`

export async function loadVisibleRules(db, userId, { order = 'r.next_date ASC' } = {}) {
  const { rows } = await db.query(
    `SELECT ${ruleColumns('r.')}, ${RULE_SHARE_COLUMNS} ${RULE_JOIN}
     WHERE r.user_id = $1 OR es.id IS NOT NULL
     ORDER BY ${order}`,
    [userId]
  )
  return rows
}

export async function loadRule(db, userId, id) {
  const { rows } = await db.query(
    `SELECT ${ruleColumns('r.')}, ${RULE_SHARE_COLUMNS} ${RULE_JOIN}
     WHERE r.id = $2 AND (r.user_id = $1 OR es.id IS NOT NULL)`,
    [userId, id]
  )
  return rows[0] ?? null
}

/**
 * Per-rule date sets for the two kinds of exception: an occurrence is paid when a
 * transaction carries the rule, and skipped when the exceptions table says so.
 */
export async function loadOccurrenceFlags(db, ruleIds) {
  const paid = new Map()
  const skipped = new Map()
  if (ruleIds.length === 0) return { paid, skipped }
  const { rows: txRows } = await db.query(
    'SELECT recurring_rule_id AS rule_id, date::text AS date FROM transactions WHERE recurring_rule_id = ANY($1::int[])',
    [ruleIds]
  )
  for (const row of txRows) {
    if (!paid.has(row.rule_id)) paid.set(row.rule_id, new Set())
    paid.get(row.rule_id).add(row.date)
  }
  const { rows: skipRows } = await db.query(
    "SELECT rule_id, occurrence_date::text AS date FROM recurring_exceptions WHERE rule_id = ANY($1::int[]) AND kind = 'skipped'",
    [ruleIds]
  )
  for (const row of skipRows) {
    if (!skipped.has(row.rule_id)) skipped.set(row.rule_id, new Set())
    skipped.get(row.rule_id).add(row.date)
  }
  return { paid, skipped }
}
