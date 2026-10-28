export const up = (pgm) => {
  // Migration 31 seeded start_date and billing_anchor_day from next_date, which is
  // the cursor the old engine had already advanced. Every rule that predates 1.4
  // therefore lost the occurrences it had already billed: the projection floor is
  // start_date, so those months can never appear on the calendar, dashboard or feed.
  // The ledger is the only trustworthy history, so the schedule is repaired from it.
  pgm.sql(`
    UPDATE recurring_rules r
    SET start_date = l.first_date,
        billing_anchor_day = CASE
          WHEN r.interval_unit IN ('month', 'year') THEN l.widest_day
          ELSE r.billing_anchor_day
        END
    FROM (
      SELECT t.recurring_rule_id AS rule_id,
             MIN(t.date) AS first_date,
             MAX(EXTRACT(DAY FROM t.date))::int AS widest_day
      FROM transactions t
      WHERE t.recurring_rule_id IS NOT NULL
      GROUP BY t.recurring_rule_id
    ) l
    WHERE l.rule_id = r.id AND r.start_date > l.first_date
  `)

  // occurrences_paid defaulted to 0 and was never reconciled with the ledger.
  pgm.sql(`
    UPDATE recurring_rules r
    SET occurrences_paid = l.booked
    FROM (
      SELECT t.recurring_rule_id AS rule_id,
             COUNT(*)::int AS booked
      FROM transactions t
      WHERE t.recurring_rule_id IS NOT NULL
      GROUP BY t.recurring_rule_id
    ) l
    WHERE l.rule_id = r.id AND r.occurrences_paid <> l.booked
  `)
}

export const down = () => {
  // Not reversible: 1.3.2 never reads these columns, and the pre-repair values were
  // already wrong for the rows this touches.
}
