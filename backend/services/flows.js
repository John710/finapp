/**
 * Flow classification for reports.
 *
 * A transfer is stored as two rows: the outgoing `transfer` row on the source
 * account and an auto-created paired leg of type `income` on the target
 * account (transfer_pair_id links them; transfer_to_account_id on the leg
 * holds the source account, also for legacy legs created before the link
 * existed — the same test the UI uses to badge a row as a transfer).
 *
 * The leg moves money between the user's own accounts, so it is not income:
 * income/expense totals, savings rate and category reports must skip it,
 * while balance walks (net worth) still need it as an inflow.
 *
 * FLOW_TYPE_SQL replaces `t.type` in a SELECT/GROUP BY: it yields
 * 'transfer_in' for the leg and the stored type for every other row. Both
 * branches are text: 'transfer_in' is longer than the varchar(10) column.
 */
export const FLOW_TYPE_SQL = `CASE WHEN t.type = 'income' AND (t.transfer_pair_id IS NOT NULL OR t.transfer_to_account_id IS NOT NULL) THEN 'transfer_in'::text ELSE t.type::text END`

// Sign of a flow row in a balance walk: money arriving adds, leaving subtracts.
export function flowSign(type) {
  return type === 'income' || type === 'transfer_in' ? 1 : -1
}
