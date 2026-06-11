export const up = (pgm) => {
  pgm.addColumn('push_subscriptions', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.createIndex('push_subscriptions', 'user_id')
}

export const down = (pgm) => {
  pgm.dropIndex('push_subscriptions', 'user_id')
  pgm.dropColumn('push_subscriptions', 'user_id')
}
