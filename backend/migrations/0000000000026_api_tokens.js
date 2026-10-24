export const up = (pgm) => {
  // Personal API tokens: the plaintext token is shown once at creation,
  // only its sha256 hash is stored.
  pgm.createTable('api_tokens', {
    id: { type: 'serial', primaryKey: true },
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    name: { type: 'varchar(100)', notNull: true },
    token_hash: { type: 'varchar(64)', notNull: true, unique: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamp' }
  })
  pgm.createIndex('api_tokens', 'user_id')
}

export const down = (pgm) => {
  pgm.dropTable('api_tokens')
}
