export const up = (pgm) => {
  // Additional indexes for common query patterns
  pgm.createIndex('notifications', ['user_id', 'is_read'])
  pgm.createIndex('notifications', ['user_id', 'type', 'created_at'])
  pgm.createIndex('recurring_rules', ['user_id', 'is_active', 'next_date'])
  pgm.createIndex('debts', ['user_id', 'status', 'due_date'])
  pgm.createIndex('transaction_tags', 'tag_id')

  // Index for exchange_rates cleanup
  pgm.createIndex('exchange_rates', 'updated_at')

  // Enforce push_subscriptions.user_id NOT NULL
  pgm.alterColumn('push_subscriptions', 'user_id', { notNull: true })
}

export const down = (pgm) => {
  pgm.alterColumn('push_subscriptions', 'user_id', { notNull: false })

  pgm.dropIndex('exchange_rates', 'updated_at')

  pgm.dropIndex('transaction_tags', 'tag_id')
  pgm.dropIndex('debts', ['user_id', 'status', 'due_date'])
  pgm.dropIndex('recurring_rules', ['user_id', 'is_active', 'next_date'])
  pgm.dropIndex('notifications', ['user_id', 'type', 'created_at'])
  pgm.dropIndex('notifications', ['user_id', 'is_read'])
}
