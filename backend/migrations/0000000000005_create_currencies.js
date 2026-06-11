export const up = (pgm) => {
  pgm.createTable('currencies', {
    code: { type: 'varchar(3)', primaryKey: true },
    name: { type: 'varchar(50)', notNull: true },
    symbol: { type: 'varchar(5)' },
    is_active: { type: 'boolean', notNull: true, default: true }
  })

  pgm.createTable('exchange_rates', {
    id: { type: 'serial', primaryKey: true },
    from_currency: { type: 'varchar(20)', notNull: true },
    to_currency: { type: 'varchar(20)', notNull: true },
    rate: { type: 'numeric(15,6)', notNull: true },
    source: { type: 'varchar(20)', notNull: true },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('exchange_rates')
  pgm.dropTable('currencies')
}
