export const up = (pgm) => {
  // Explicit link from the auto-created paired income leg of a transfer to its
  // source transfer row. Before this column the pairing was implicit (matching
  // accounts + type), which was ambiguous when several transfers existed between
  // the same two accounts and lost the actual credited amount on cross-currency
  // transfers.
  pgm.addColumn('transactions', {
    transfer_pair_id: { type: 'integer', references: 'transactions', onDelete: 'SET NULL' }
  })
  pgm.createIndex('transactions', 'transfer_pair_id')

  // Backfill: the source row and its paired leg are inserted inside one DB
  // transaction, so they share the same created_at timestamp. Only link pairs
  // that are still unambiguous (one candidate per source row).
  pgm.sql(`
    UPDATE transactions leg
    SET transfer_pair_id = src.id
    FROM transactions src
    WHERE src.type = 'transfer'
      AND leg.type = 'income'
      AND leg.transfer_pair_id IS NULL
      AND src.transfer_to_account_id IS NOT NULL
      AND leg.transfer_to_account_id IS NOT NULL
      AND leg.user_id = src.user_id
      AND leg.account_id = src.transfer_to_account_id
      AND leg.transfer_to_account_id = src.account_id
      AND leg.created_at = src.created_at
      AND src.id NOT IN (SELECT transfer_pair_id FROM transactions WHERE transfer_pair_id IS NOT NULL)
  `)
  // Make the link bidirectional: the source transfer row also points at its leg
  pgm.sql(`
    UPDATE transactions src
    SET transfer_pair_id = leg.id
    FROM transactions leg
    WHERE leg.transfer_pair_id = src.id
      AND src.transfer_pair_id IS NULL
  `)
}

export const down = (pgm) => {
  pgm.dropIndex('transactions', 'transfer_pair_id')
  pgm.dropColumn('transactions', 'transfer_pair_id')
}
