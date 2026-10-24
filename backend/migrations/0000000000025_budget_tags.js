export const up = (pgm) => {
  // Budgets can target a category, a set of tags, or both: a transaction
  // counts towards the budget when it matches the category OR any tag.
  pgm.createTable('budget_tags', {
    budget_id: { type: 'integer', notNull: true, references: 'budgets', onDelete: 'CASCADE' },
    tag_id: { type: 'integer', notNull: true, references: 'tags', onDelete: 'CASCADE' }
  })
  pgm.addConstraint('budget_tags', 'budget_tags_pk', 'PRIMARY KEY (budget_id, tag_id)')
}

export const down = (pgm) => {
  pgm.dropTable('budget_tags')
}
