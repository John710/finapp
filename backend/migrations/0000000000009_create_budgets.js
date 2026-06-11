export const up = (pgm) => {
  pgm.createTable('budgets', {
    id: { type: 'serial', primaryKey: true },
    category_id: { type: 'integer', references: 'categories', onDelete: 'CASCADE' },
    amount: { type: 'numeric(24,12)', notNull: true },
    currency: { type: 'varchar(10)', notNull: true, default: 'USD' },
    period: { type: 'varchar(10)', notNull: true, default: 'month' },
    start_date: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('budgets')
}
