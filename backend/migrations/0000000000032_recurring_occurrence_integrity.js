export const up = (pgm) => {
  // v1.3.2 deleted rules without clearing transactions.recurring_rule_id, and
  // could book the same occurrence twice. Real databases upgrading from 1.3.x
  // therefore hold orphan links and duplicate (rule, date) pairs, which made the
  // FK and the unique index below fail — and docker-entrypoint (set -e) then
  // crash-looped. Both clean-ups only unlink: the transactions, amounts and
  // balances stay as they are. On a database that is already consistent they
  // match no rows. (Edited in place on purpose: databases where this migration
  // already ran never re-run it, and for them the clean-up would be a no-op.)
  pgm.sql(`
    UPDATE transactions t SET recurring_rule_id = NULL
    WHERE t.recurring_rule_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM recurring_rules r WHERE r.id = t.recurring_rule_id)
  `)
  // Keep the earliest booking of each occurrence linked; later copies become
  // ordinary transactions. Migration 35 recounts occurrences_paid afterwards.
  pgm.sql(`
    UPDATE transactions t SET recurring_rule_id = NULL
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY recurring_rule_id, date ORDER BY id) AS rn
      FROM transactions
      WHERE recurring_rule_id IS NOT NULL
    ) d
    WHERE t.id = d.id AND d.rn > 1
  `)
  pgm.addConstraint('transactions', 'transactions_recurring_rule_fkey', {
    foreignKeys: { columns: 'recurring_rule_id', references: 'recurring_rules(id)', onDelete: 'SET NULL' }
  })
  // Upserts against this index must repeat the predicate:
  // ON CONFLICT (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL
  pgm.createIndex('transactions', ['recurring_rule_id', 'date'], {
    name: 'transactions_recurring_occ_uniq',
    unique: true,
    where: 'recurring_rule_id IS NOT NULL'
  })
}

export const down = (pgm) => {
  pgm.dropIndex('transactions', ['recurring_rule_id', 'date'], { name: 'transactions_recurring_occ_uniq', ifExists: true })
  pgm.dropConstraint('transactions', 'transactions_recurring_rule_fkey', { ifExists: true })
}
