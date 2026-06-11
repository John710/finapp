export const up = (pgm) => {
  pgm.createTable('tags', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'varchar(50)', notNull: true },
    color: { type: 'varchar(7)' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export const down = (pgm) => {
  pgm.dropTable('tags')
}
