export const up = (pgm) => {
  // Categories and tags become GLOBAL (shared by every user of the instance).
  // Same-name duplicates across users are merged: the oldest row wins, all
  // references are repointed and the extra rows are removed.

  // ---- categories: merge duplicates by (lower(name), type) ----
  pgm.sql(`
    UPDATE transactions t
    SET category_id = winners.target_id
    FROM (
      SELECT dup.id AS dup_id, min(dup.id) OVER (PARTITION BY lower(dup.name), dup.type) AS target_id
      FROM categories dup
    ) winners
    WHERE t.category_id = winners.dup_id AND winners.dup_id <> winners.target_id
  `)
  pgm.sql(`
    UPDATE recurring_rules r
    SET category_id = winners.target_id
    FROM (
      SELECT dup.id AS dup_id, min(dup.id) OVER (PARTITION BY lower(dup.name), dup.type) AS target_id
      FROM categories dup
    ) winners
    WHERE r.category_id = winners.dup_id AND winners.dup_id <> winners.target_id
  `)
  pgm.sql(`
    UPDATE budgets b
    SET category_id = winners.target_id
    FROM (
      SELECT dup.id AS dup_id, min(dup.id) OVER (PARTITION BY lower(dup.name), dup.type) AS target_id
      FROM categories dup
    ) winners
    WHERE b.category_id = winners.dup_id AND winners.dup_id <> winners.target_id
  `)
  // Drop now-duplicate categories (keep the lowest id per name+type)
  pgm.sql(`
    DELETE FROM categories dup
    USING categories keep
    WHERE lower(keep.name) = lower(dup.name) AND keep.type = dup.type AND keep.id < dup.id
  `)

  // ---- tags: merge duplicates by lower(name) ----
  pgm.sql(`
    UPDATE transaction_tags tt
    SET tag_id = winners.target_id
    FROM (
      SELECT dup.id AS dup_id, min(dup.id) OVER (PARTITION BY lower(dup.name)) AS target_id
      FROM tags dup
    ) winners
    WHERE tt.tag_id = winners.dup_id AND winners.dup_id <> winners.target_id
  `)
  pgm.sql(`
    UPDATE budget_tags bt
    SET tag_id = winners.target_id
    FROM (
      SELECT dup.id AS dup_id, min(dup.id) OVER (PARTITION BY lower(dup.name)) AS target_id
      FROM tags dup
    ) winners
    WHERE bt.tag_id = winners.dup_id AND winners.dup_id <> winners.target_id
  `)
  pgm.sql(`
    DELETE FROM tags dup
    USING tags keep
    WHERE lower(keep.name) = lower(dup.name) AND keep.id < dup.id
  `)
  // transaction_tags may now hold (transaction_id, tag_id) duplicates — dedupe
  pgm.sql(`
    DELETE FROM transaction_tags a
    USING transaction_tags b
    WHERE a.transaction_id = b.transaction_id AND a.tag_id = b.tag_id AND a.ctid > b.ctid
  `)

  // ---- drop per-user scoping ----
  pgm.dropConstraint('categories', 'categories_user_id_name_type_unique', { ifExists: true })
  pgm.dropConstraint('tags', 'tags_user_id_name_unique', { ifExists: true })
  pgm.dropColumn('categories', 'user_id')
  pgm.dropColumn('tags', 'user_id')
  pgm.dropColumn('transaction_tags', 'user_id')
  pgm.addConstraint('categories', 'categories_name_type_unique', { unique: ['name', 'type'] })
  pgm.addConstraint('tags', 'tags_name_unique', { unique: ['name'] })
  pgm.dropIndex('categories', 'user_id')
  pgm.dropIndex('tags', 'user_id')
  pgm.dropIndex('transaction_tags', 'user_id')
}

export const down = (pgm) => {
  // Irreversible without per-user attribution: restore the columns owned by
  // the first user and hope no cross-user duplicates existed.
  pgm.dropConstraint('categories', 'categories_name_type_unique', { ifExists: true })
  pgm.dropConstraint('tags', 'tags_name_unique', { ifExists: true })
  pgm.addColumn('categories', { user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' } })
  pgm.addColumn('tags', { user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' } })
  pgm.addColumn('transaction_tags', { user_id: { type: 'integer', references: 'users', onDelete: 'CASCADE' } })
  pgm.sql(`UPDATE categories SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE tags SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`)
  pgm.sql(`UPDATE transaction_tags tt SET user_id = (SELECT user_id FROM transactions WHERE id = tt.transaction_id)`)
  pgm.alterColumn('categories', 'user_id', { notNull: true })
  pgm.alterColumn('tags', 'user_id', { notNull: true })
  pgm.alterColumn('transaction_tags', 'user_id', { notNull: true })
  pgm.addConstraint('categories', 'categories_user_id_name_type_unique', { unique: ['user_id', 'name', 'type'] })
  pgm.addConstraint('tags', 'tags_user_id_name_unique', { unique: ['user_id', 'name'] })
  pgm.createIndex('categories', 'user_id')
  pgm.createIndex('tags', 'user_id')
  pgm.createIndex('transaction_tags', 'user_id')
}
