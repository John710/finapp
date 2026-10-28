export const up = (pgm) => {
  // Calendar clients can only be handed a URL, so the feed credential has to fit
  // in a request. It is deliberately not an api_tokens row: those authenticate a
  // whole account with write access, and a feed URL is copied around and ends up
  // in sync logs. This table holds a digest of a read-only, revocable feed token.
  pgm.createTable('recurring_feed_tokens', {
    id: { type: 'serial', primaryKey: true },
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    name: { type: 'varchar(100)', notNull: true },
    token_hash: { type: 'varchar(64)', notNull: true, unique: true },
    last_used_at: { type: 'timestamp' },
    revoked_at: { type: 'timestamp' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('recurring_feed_tokens', 'user_id')
}

export const down = (pgm) => {
  pgm.dropTable('recurring_feed_tokens')
}
