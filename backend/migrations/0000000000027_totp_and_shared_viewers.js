export const up = (pgm) => {
  // TOTP two-factor auth; the secret is stored encrypted (services/crypto).
  pgm.addColumn('users', {
    totp_secret: { type: 'text' }
  })
  pgm.addColumn('users', {
    totp_enabled: { type: 'boolean', notNull: true, default: false }
  })
  // Shared read-only access: a "viewer" user reads the owner's data
  // (effective user id = shared_owner_id) and cannot mutate anything.
  pgm.addColumn('users', {
    role: { type: 'varchar(10)', notNull: true, default: 'owner' }
  })
  pgm.addColumn('users', {
    shared_owner_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' }
  })
}

export const down = (pgm) => {
  pgm.dropColumn('users', 'shared_owner_id')
  pgm.dropColumn('users', 'role')
  pgm.dropColumn('users', 'totp_enabled')
  pgm.dropColumn('users', 'totp_secret')
}
