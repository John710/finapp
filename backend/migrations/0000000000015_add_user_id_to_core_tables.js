export const up = (pgm) => {
  // Add user_id columns
  pgm.addColumn('accounts', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('categories', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('tags', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('transactions', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('transaction_tags', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('budgets', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('debts', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('debt_payments', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.addColumn('recurring_rules', {
    user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })

  // Backfill existing rows with the first user
  pgm.sql(`UPDATE accounts SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE categories SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE tags SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE transactions SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE transaction_tags SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE budgets SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE debts SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE debt_payments SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE recurring_rules SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)

  // Set NOT NULL after backfill
  pgm.alterColumn('accounts', 'user_id', { notNull: true })
  pgm.alterColumn('categories', 'user_id', { notNull: true })
  pgm.alterColumn('tags', 'user_id', { notNull: true })
  pgm.alterColumn('transactions', 'user_id', { notNull: true })
  pgm.alterColumn('transaction_tags', 'user_id', { notNull: true })
  pgm.alterColumn('budgets', 'user_id', { notNull: true })
  pgm.alterColumn('debts', 'user_id', { notNull: true })
  pgm.alterColumn('debt_payments', 'user_id', { notNull: true })
  pgm.alterColumn('recurring_rules', 'user_id', { notNull: true })

  // Indexes
  pgm.createIndex('accounts', 'user_id')
  pgm.createIndex('categories', 'user_id')
  pgm.createIndex('tags', 'user_id')
  pgm.createIndex('transactions', 'user_id')
  pgm.createIndex('transaction_tags', 'user_id')
  pgm.createIndex('budgets', 'user_id')
  pgm.createIndex('debts', 'user_id')
  pgm.createIndex('debt_payments', 'user_id')
  pgm.createIndex('recurring_rules', 'user_id')

  // Composite unique constraints
  pgm.addConstraint('accounts', 'accounts_user_id_name_unique', { unique: ['user_id', 'name'] })
  pgm.addConstraint('categories', 'categories_user_id_name_type_unique', { unique: ['user_id', 'name', 'type'] })
  pgm.addConstraint('tags', 'tags_user_id_name_unique', { unique: ['user_id', 'name'] })

  // Update push_subscriptions unique constraint to be per-user
  pgm.dropConstraint('push_subscriptions', 'push_subscriptions_endpoint_unique', { ifExists: true })
  pgm.addConstraint('push_subscriptions', 'push_subscriptions_user_id_endpoint_unique', { unique: ['user_id', 'endpoint'] })
}

export const down = (pgm) => {
  pgm.dropConstraint('push_subscriptions', 'push_subscriptions_user_id_endpoint_unique', { ifExists: true })
  pgm.addConstraint('push_subscriptions', 'push_subscriptions_endpoint_unique', { unique: ['endpoint'] })

  pgm.dropConstraint('accounts', 'accounts_user_id_name_unique')
  pgm.dropConstraint('categories', 'categories_user_id_name_type_unique')
  pgm.dropConstraint('tags', 'tags_user_id_name_unique')

  pgm.dropColumn('accounts', 'user_id')
  pgm.dropColumn('categories', 'user_id')
  pgm.dropColumn('tags', 'user_id')
  pgm.dropColumn('transactions', 'user_id')
  pgm.dropColumn('transaction_tags', 'user_id')
  pgm.dropColumn('budgets', 'user_id')
  pgm.dropColumn('debts', 'user_id')
  pgm.dropColumn('debt_payments', 'user_id')
  pgm.dropColumn('recurring_rules', 'user_id')
}
