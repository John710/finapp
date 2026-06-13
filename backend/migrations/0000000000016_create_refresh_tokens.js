export const up = (pgm) => {
  pgm.createTable('refresh_tokens', {
    id: { type: 'serial', primaryKey: true },
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    token_hash: { type: 'varchar(255)', notNull: true },
    expires_at: { type: 'timestamp', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })

  pgm.createIndex('refresh_tokens', 'token_hash')
  pgm.createIndex('refresh_tokens', 'user_id')
}

export const down = (pgm) => {
  pgm.dropTable('refresh_tokens')
}
