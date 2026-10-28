export const up = (pgm) => {
  // Exceptions are the only schedule state that cannot be derived: a skipped
  // occurrence. There is deliberately no kind = 'moved' — moving a payment is a
  // plain edit of transactions.date, otherwise the projection and the ledger
  // would disagree about where the occurrence falls.
  pgm.createTable('recurring_exceptions', {
    id: { type: 'serial', primaryKey: true },
    rule_id: { type: 'integer', notNull: true, references: 'recurring_rules', onDelete: 'CASCADE' },
    occurrence_date: { type: 'date', notNull: true },
    kind: { type: 'varchar(10)', notNull: true, check: "kind IN ('skipped')" },
    note: { type: 'text' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('recurring_exceptions', ['rule_id', 'occurrence_date'], { unique: true })

  pgm.createTable('recurring_history', {
    id: { type: 'serial', primaryKey: true },
    rule_id: { type: 'integer', notNull: true, references: 'recurring_rules', onDelete: 'CASCADE' },
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    event_type: {
      type: 'varchar(20)',
      notNull: true,
      check: "event_type IN ('created', 'price_changed', 'schedule_changed', 'currency_changed', 'paused', 'resumed', 'ended', 'skipped', 'paid')"
    },
    old_value: { type: 'jsonb' },
    new_value: { type: 'jsonb' },
    effective_date: { type: 'date' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('recurring_history', ['rule_id', 'created_at'])
}

export const down = (pgm) => {
  pgm.dropTable('recurring_history')
  pgm.dropTable('recurring_exceptions')
}
