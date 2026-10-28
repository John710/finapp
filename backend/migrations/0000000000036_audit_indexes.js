// Indexes for the lookups the routes actually run, none of which an earlier
// migration covers (checked against 0001–0035):
//  - transactions by account and date (visible-account reports, account views)
//    and by transfer target (incoming legs, account deletion compensation);
//  - the latest exchange rate per pair (DISTINCT ON ... ORDER BY updated_at DESC
//    on every report and conversion);
//  - a user's notification feed, newest first;
//  - foreign keys that are filtered or cascaded on: debt_payments.debt_id,
//    budgets.category_id, budget_tags.tag_id (the PK leads with budget_id),
//    recurring_rules.account_id, debts.account_id.
// IF NOT EXISTS keeps the migration safe on instances where an index was
// added by hand.
//
// exchange_rates.rate was numeric(15,6): six decimals round a 0.00001 USD
// token to almost nothing and cap a rate below 10^9. numeric(30,18) keeps
// small crypto prices and large fiat rates exact.

const INDEXES = [
  ['transactions_account_id_date_idx', 'transactions (account_id, date DESC)'],
  ['transactions_transfer_to_account_id_idx', 'transactions (transfer_to_account_id)'],
  ['exchange_rates_pair_updated_at_idx', 'exchange_rates (from_currency, to_currency, updated_at DESC)'],
  ['notifications_user_id_created_at_idx', 'notifications (user_id, created_at DESC)'],
  ['debt_payments_debt_id_idx', 'debt_payments (debt_id)'],
  ['budgets_category_id_idx', 'budgets (category_id)'],
  ['budget_tags_tag_id_idx', 'budget_tags (tag_id)'],
  ['recurring_rules_account_id_idx', 'recurring_rules (account_id)'],
  ['debts_account_id_idx', 'debts (account_id)']
]

export const up = (pgm) => {
  for (const [name, target] of INDEXES) {
    pgm.sql(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`)
  }
  pgm.sql('ALTER TABLE exchange_rates ALTER COLUMN rate TYPE numeric(30,18)')
}

export const down = (pgm) => {
  // Narrowing rounds rates back to six decimals; a rate above the old
  // precision (>= 10^9) would make this fail rather than silently corrupt.
  pgm.sql('ALTER TABLE exchange_rates ALTER COLUMN rate TYPE numeric(15,6)')
  for (const [name] of [...INDEXES].reverse()) {
    pgm.sql(`DROP INDEX IF EXISTS ${name}`)
  }
}
