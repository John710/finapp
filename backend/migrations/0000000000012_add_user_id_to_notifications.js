export const up = (pgm) => {
  pgm.addColumn('notifications', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.createIndex('notifications', 'user_id')
}

export const down = (pgm) => {
  pgm.dropIndex('notifications', 'user_id')
  pgm.dropColumn('notifications', 'user_id')
}
