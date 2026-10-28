export const up = (pgm) => {
  // Recurring rules become real schedules: the next occurrence is derived from
  // (start_date, billing_anchor_day, interval_value, interval_unit) instead of
  // being nudged forward by `next_date + INTERVAL`, which ratchets a 31st
  // anchor onto the 28th of every following month.
  pgm.addColumns('recurring_rules', {
    interval_value: { type: 'integer', notNull: true, default: 1, check: 'interval_value BETWEEN 1 AND 100' },
    interval_unit: { type: 'varchar(10)', notNull: true, default: 'month', check: "interval_unit IN ('day', 'week', 'month', 'year')" },
    billing_anchor_day: { type: 'integer', check: 'billing_anchor_day BETWEEN 1 AND 31' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    cancellation_date: { type: 'date' },
    auto_renew: { type: 'boolean', notNull: true, default: true },
    payment_limit: { type: 'integer', check: 'payment_limit > 0' },
    occurrences_paid: { type: 'integer', notNull: true, default: 0 },
    last_run_date: { type: 'date' },
    notify_days_before: { type: 'integer', default: 0, check: 'notify_days_before BETWEEN 0 AND 90' },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })

  // `frequency` stays populated (the API keeps writing it) so the container can
  // be rolled back to finapp:1.3.2, whose cron only understands it.
  pgm.sql(`
    UPDATE recurring_rules SET
      interval_unit = CASE
        WHEN frequency = 'daily' THEN 'day'
        WHEN frequency IN ('weekly', 'biweekly') THEN 'week'
        WHEN frequency = 'yearly' THEN 'year'
        ELSE 'month'
      END,
      interval_value = CASE WHEN frequency = 'biweekly' THEN 2 ELSE 1 END,
      start_date = COALESCE(start_date, next_date),
      billing_anchor_day = COALESCE(billing_anchor_day, EXTRACT(DAY FROM next_date)::int)
  `)
}

export const down = (pgm) => {
  pgm.dropColumns('recurring_rules', [
    'interval_value',
    'interval_unit',
    'billing_anchor_day',
    'start_date',
    'end_date',
    'cancellation_date',
    'auto_renew',
    'payment_limit',
    'occurrences_paid',
    'last_run_date',
    'notify_days_before',
    'updated_at'
  ])
}
