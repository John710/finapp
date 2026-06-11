export const up = (pgm) => {
  pgm.createTable('accounts', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'varchar(100)', notNull: true },
    type: { type: 'varchar(20)', notNull: true },
    currency: { type: 'varchar(10)', notNull: true, default: 'USD' },
    balance: { type: 'numeric(24,12)', notNull: true, default: 0 },
    color: { type: 'varchar(7)' },
    icon: { type: 'varchar(50)' },
    target_amount: { type: 'numeric(24,12)', default: 0 },
    is_archived: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('accounts')
}
