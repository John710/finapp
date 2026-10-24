export const up = (pgm) => {
  // Composite indexes for the hottest transaction queries: every list view
  // filters by user and sorts/filters by date, budgets and category filters
  // join by (user_id, category_id).
  pgm.createIndex('transactions', ['user_id', 'date'], { name: 'idx_transactions_user_date' })
  pgm.createIndex('transactions', ['user_id', 'category_id'], { name: 'idx_transactions_user_category' })

  // Trigram index for note ILIKE '%search%' lookups. CREATE EXTENSION may be
  // denied on managed instances where the app user is not superuser/owner —
  // the extension and the index are both optional, so failures are logged and
  // skipped instead of failing the migration.
  pgm.sql(`
    DO $$
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION
      WHEN insufficient_privilege OR duplicate_object THEN
        RAISE NOTICE 'pg_trgm extension unavailable (%), skipping trigram index', SQLERRM;
    END
    $$;
  `)
  pgm.sql(`
    DO $$
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_transactions_note_trgm ON transactions USING gin (note gin_trgm_ops);
    EXCEPTION
      WHEN undefined_object THEN
        RAISE NOTICE 'gin_trgm_ops unavailable, skipping trigram index';
    END
    $$;
  `)
}

export const down = (pgm) => {
  pgm.dropIndex('transactions', ['user_id', 'category_id'], { name: 'idx_transactions_user_category' })
  pgm.dropIndex('transactions', ['user_id', 'date'], { name: 'idx_transactions_user_date' })
  pgm.sql('DROP INDEX IF EXISTS idx_transactions_note_trgm')
}
