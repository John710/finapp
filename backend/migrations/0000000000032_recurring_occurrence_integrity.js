export const up = (pgm) => {
  // Deploy precondition (run both on the live DB first, see .qoder plan §2):
  // duplicate (recurring_rule_id, date) rows and recurring_rule_id values that
  // point at deleted rules make these two statements fail.
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
