export const up = (pgm) => {
  // New users are plain users by default; the first (admin) user is created
  // via /auth/register, which inserts role='admin' explicitly. Migration 28
  // converted pre-existing 'owner' rows — this catches any rows created
  // between 27 and 28-style deploys where the old default leaked.
  pgm.alterColumn('users', 'role', { default: 'user' })
  pgm.sql("UPDATE users SET role = 'admin' WHERE role = 'owner'")
}

export const down = (pgm) => {
  pgm.alterColumn('users', 'role', { default: 'owner' })
}
