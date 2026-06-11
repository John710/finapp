export const up = (pgm) => {
  pgm.createTable('categories', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'varchar(100)', notNull: true },
    type: { type: 'varchar(10)', notNull: true, check: "type IN ('income', 'expense')" },
    color: { type: 'varchar(7)' },
    icon: { type: 'varchar(50)' },
    icon_custom: { type: 'text' },
    parent_id: { type: 'integer', references: 'categories', onDelete: 'SET NULL' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('categories')
}
