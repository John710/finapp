export const up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'serial', primaryKey: true },
    login: { type: 'varchar(50)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    language: { type: 'varchar(10)', notNull: true, default: 'ru' },
    base_currency: { type: 'varchar(10)', notNull: true, default: 'USD' },
    coingecko_api_key: { type: 'varchar(100)' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('users')
}
