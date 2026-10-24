export const up = (pgm) => {
  // Replace the old shared-viewer model: all users become peers. The first
  // user (the only one that could exist as 'owner') becomes the admin.
  pgm.sql("DELETE FROM users WHERE role = 'viewer'")
  pgm.sql("UPDATE users SET role = 'admin' WHERE role = 'owner'")
  pgm.dropColumn('users', 'shared_owner_id')

  // Entity-level family sharing: a user grants access to their accounts,
  // budgets, debts and recurring rules to everyone (shared_with NULL) or to
  // a specific user. entity_id references the entity's table — no FK by
  // design (generic table); rows are cleaned up by the owning route.
  pgm.createTable('entity_shares', {
    id: { type: 'serial', primaryKey: true },
    entity_type: { type: 'varchar(20)', notNull: true },
    entity_id: { type: 'integer', notNull: true },
    owner_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    shared_with: { type: 'integer', references: 'users', onDelete: 'CASCADE' },
    permission: { type: 'varchar(10)', notNull: true, default: 'edit' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.sql("CREATE UNIQUE INDEX entity_shares_target_unique ON entity_shares (entity_type, entity_id, COALESCE(shared_with, 0))")
  pgm.createIndex('entity_shares', ['shared_with'])
  pgm.createIndex('entity_shares', ['owner_id'])

  // Audit: who actually created a transaction / made a debt payment
  // (on shared accounts the row owner is the account owner).
  pgm.addColumn('transactions', {
    created_by: { type: 'integer', references: 'users', onDelete: 'SET NULL' }
  })
  pgm.sql('UPDATE transactions SET created_by = user_id WHERE created_by IS NULL')
  pgm.addColumn('debt_payments', {
    created_by: { type: 'integer', references: 'users', onDelete: 'SET NULL' }
  })
  pgm.sql('UPDATE debt_payments SET created_by = user_id WHERE created_by IS NULL')
}

export const down = (pgm) => {
  pgm.dropColumn('debt_payments', 'created_by')
  pgm.dropColumn('transactions', 'created_by')
  pgm.dropTable('entity_shares')
  pgm.addColumn('users', {
    shared_owner_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
  pgm.sql("UPDATE users SET role = 'owner' WHERE role = 'admin'")
}
