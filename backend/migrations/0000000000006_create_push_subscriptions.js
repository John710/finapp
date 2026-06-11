export const up = (pgm) => {
  pgm.createTable('push_subscriptions', {
    id: { type: 'serial', primaryKey: true },
    endpoint: { type: 'text', notNull: true },
    p256dh: { type: 'text', notNull: true },
    auth: { type: 'text', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') }
  })
  pgm.createIndex('push_subscriptions', 'endpoint', { unique: true })
}

export const down = (pgm) => {
  pgm.dropTable('push_subscriptions')
}
