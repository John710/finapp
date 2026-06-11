export const up = (pgm) => {
  pgm.addColumn('accounts', {
    sort_order: { type: 'integer', notNull: true, default: 0 }
  })
  pgm.createIndex('accounts', ['type', 'sort_order'])
}

export const down = (pgm) => {
  pgm.dropIndex('accounts', ['type', 'sort_order'])
  pgm.dropColumn('accounts', 'sort_order')
}
