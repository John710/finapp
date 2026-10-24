export const up = (pgm) => {
  // Receipts/files attached to transactions, stored in the database so the
  // container filesystem stays stateless. Size is enforced at the API level.
  pgm.createTable('attachments', {
    id: { type: 'serial', primaryKey: true },
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    transaction_id: { type: 'integer', notNull: true, references: 'transactions', onDelete: 'CASCADE' },
    filename: { type: 'varchar(255)', notNull: true },
    mime: { type: 'varchar(100)', notNull: true },
    size: { type: 'integer', notNull: true },
    data: { type: 'bytea', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('attachments', ['user_id', 'transaction_id'])
}

export const down = (pgm) => {
  pgm.dropTable('attachments')
}
