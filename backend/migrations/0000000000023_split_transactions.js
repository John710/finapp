export const up = (pgm) => {
  // Split transactions: a parent row (is_split = true) carries the full
  // amount and the account balance effect; child rows (parent_id set) hold
  // the per-category amounts and are bookkeeping only (no balance effect).
  pgm.addColumn('transactions', {
    parent_id: { type: 'integer', references: 'transactions', onDelete: 'CASCADE' }
  })
  pgm.addColumn('transactions', {
    is_split: { type: 'boolean', notNull: true, default: false }
  })
  pgm.createIndex('transactions', 'parent_id')
}

export const down = (pgm) => {
  pgm.dropIndex('transactions', 'parent_id')
  pgm.dropColumn('transactions', 'is_split')
  pgm.dropColumn('transactions', 'parent_id')
}
