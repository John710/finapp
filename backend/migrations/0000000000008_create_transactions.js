export const up = (pgm) => {
  pgm.createTable('transactions', {
    id: { type: 'serial', primaryKey: true },
    account_id: { type: 'integer', notNull: true, references: 'accounts', onDelete: 'CASCADE' },
    category_id: { type: 'integer', references: 'categories', onDelete: 'SET NULL' },
    amount: { type: 'numeric(24,12)', notNull: true },
    type: { type: 'varchar(10)', notNull: true, check: "type IN ('income', 'expense', 'transfer')" },
    date: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
    note: { type: 'text' },
    transfer_to_account_id: { type: 'integer', references: 'accounts', onDelete: 'SET NULL' },
    recurring_rule_id: { type: 'integer' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('transaction_tags', {
    transaction_id: { type: 'integer', notNull: true, references: 'transactions', onDelete: 'CASCADE' },
    tag_id: { type: 'integer', notNull: true, references: 'tags', onDelete: 'CASCADE' }
  })
  pgm.addConstraint('transaction_tags', 'transaction_tags_pkey', { primaryKey: ['transaction_id', 'tag_id'] })
}

export const down = (pgm) => {
  pgm.dropTable('transaction_tags')
  pgm.dropTable('transactions')
}
