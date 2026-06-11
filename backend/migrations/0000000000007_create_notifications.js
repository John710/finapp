export const up = (pgm) => {
  pgm.createTable('notifications', {
    id: { type: 'serial', primaryKey: true },
    type: { type: 'varchar(50)', notNull: true },
    title: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    data: { type: 'jsonb', default: '{}' },
    is_read: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') }
  })
  pgm.createIndex('notifications', 'created_at', { order: 'DESC' })
  pgm.createIndex('notifications', 'is_read')
}

export const down = (pgm) => {
  pgm.dropTable('notifications')
}
