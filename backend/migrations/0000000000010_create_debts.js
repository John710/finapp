export const up = (pgm) => {
  pgm.createTable('debts', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'varchar(100)', notNull: true },
    counterparty: { type: 'varchar(100)', notNull: true },
    amount: { type: 'numeric(24,12)', notNull: true },
    currency: { type: 'varchar(10)', notNull: true, default: 'USD' },
    type: { type: 'varchar(10)', notNull: true, check: "type IN ('lend', 'borrow')" },
    due_date: { type: 'date' },
    description: { type: 'text' },
    status: { type: 'varchar(10)', notNull: true, default: 'active' },
    account_id: { type: 'integer', references: 'accounts', onDelete: 'SET NULL' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('debt_payments', {
    id: { type: 'serial', primaryKey: true },
    debt_id: { type: 'integer', notNull: true, references: 'debts', onDelete: 'CASCADE' },
    amount: { type: 'numeric(24,12)', notNull: true },
    currency: { type: 'varchar(10)', notNull: true, default: 'USD' },
    note: { type: 'text' },
    account_id: { type: 'integer', references: 'accounts', onDelete: 'SET NULL' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('debt_payments')
  pgm.dropTable('debts')
}
