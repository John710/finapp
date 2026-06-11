export const up = (pgm) => {
  pgm.createTable('recurring_rules', {
    id: { type: 'serial', primaryKey: true },
    account_id: { type: 'integer', notNull: true, references: 'accounts', onDelete: 'CASCADE' },
    category_id: { type: 'integer', references: 'categories', onDelete: 'SET NULL' },
    amount: { type: 'numeric(24,12)', notNull: true },
    currency: { type: 'varchar(10)', notNull: true, default: 'USD' },
    type: { type: 'varchar(10)', notNull: true, check: "type IN ('income', 'expense')" },
    frequency: { type: 'varchar(20)', notNull: true },
    next_date: { type: 'date', notNull: true },
    note: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('recurring_rules')
}
