import { describe, it, expect } from 'vitest'
import {
  occurrenceDates,
  nextOccurrenceAfter,
  occurrenceAllowed,
  nthOccurrence,
  statusOf,
  monthlyEquivalent,
  toLegacyFrequency,
  frequencyToSchedule,
  initialNextDate,
  resolveProjectionWindow,
  dueOccurrence,
  planRuleRun,
  projectOccurrences,
  buildSchedulePatch
} from '../services/recurring-schedule.js'

// All dates are 'YYYY-MM-DD' strings — the same shape the routes read with `::text`
// casts, so no process timezone can move a day.

function rule(overrides = {}) {
  return {
    interval_value: 1,
    interval_unit: 'month',
    billing_anchor_day: null,
    start_date: '2026-01-31',
    end_date: null,
    cancellation_date: null,
    auto_renew: true,
    payment_limit: null,
    next_date: '2026-01-31',
    is_active: true,
    amount: '100.000000000000',
    currency: 'USD',
    ...overrides
  }
}

function weekday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay()
}

describe('monthly anchor math', () => {
  it('keeps the anchor across short months instead of drifting', () => {
    expect(occurrenceDates(rule({ start_date: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ])
  })

  it('clamps an anchor of 31 to the last day of short months', () => {
    const dates = occurrenceDates(rule({ start_date: '2026-01-31', interval_value: 2 }), '2026-01-01', '2026-12-31')
    expect(dates).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-09-30', '2026-11-30'])
  })

  it('clamps an anchor of 30 to February without dragging later months back', () => {
    expect(occurrenceDates(rule({ start_date: '2026-01-30' }), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-30',
      '2026-02-28',
      '2026-03-30',
      '2026-04-30',
      '2026-05-30'
    ])
  })

  it('takes the anchor day from the rule when it differs from the start date', () => {
    const dates = occurrenceDates(rule({ start_date: '2026-01-05', billing_anchor_day: 31 }), '2026-01-01', '2026-04-30')
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
})

describe('other interval units', () => {
  it('keeps the weekday for every N weeks', () => {
    const dates = occurrenceDates(
      rule({ start_date: '2026-01-05', interval_unit: 'week', interval_value: 5 }),
      '2026-01-01',
      '2026-03-31'
    )
    expect(dates).toEqual(['2026-01-05', '2026-02-09', '2026-03-16'])
    for (const date of dates) expect(weekday(date)).toBe(1)
  })

  it('steps plain days by the interval value', () => {
    const dates = occurrenceDates(
      rule({ start_date: '2026-01-05', interval_unit: 'day', interval_value: 14 }),
      '2026-01-01',
      '2026-03-01'
    )
    expect(dates).toEqual(['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16'])
  })

  it('clamps Feb 29 in common years and returns to it in a leap year', () => {
    const dates = occurrenceDates(rule({ start_date: '2024-02-29', interval_unit: 'year' }), '2024-01-01', '2028-12-31')
    expect(dates).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('treats a Feb 29 monthly anchor as end-of-February outside leap years', () => {
    const dates = occurrenceDates(rule({ start_date: '2026-01-29', billing_anchor_day: 29 }), '2026-01-01', '2026-04-30')
    expect(dates).toEqual(['2026-01-29', '2026-02-28', '2026-03-29', '2026-04-29'])
  })
})

describe('schedule boundaries', () => {
  it('emits nothing before the start date', () => {
    expect(occurrenceDates(rule({ start_date: '2026-03-10' }), '2026-01-01', '2026-03-09')).toEqual([])
    expect(occurrenceDates(rule({ start_date: '2026-03-10' }), '2026-01-01', '2026-03-20')).toEqual(['2026-03-10'])
  })

  it('includes the end date but nothing after it', () => {
    const r = rule({ start_date: '2026-01-31', end_date: '2026-03-31' })
    expect(occurrenceDates(r, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(occurrenceAllowed(r, '2026-03-31')).toBe(true)
    expect(occurrenceAllowed(r, '2026-04-30')).toBe(false)
  })

  it('uses whichever of end_date and cancellation_date comes first', () => {
    const cancelledFirst = rule({ start_date: '2026-01-01', interval_unit: 'day', cancellation_date: '2026-01-10', end_date: '2026-06-30' })
    expect(occurrenceDates(cancelledFirst, '2026-01-08', '2026-02-01')).toEqual(['2026-01-08', '2026-01-09', '2026-01-10'])
    const endedFirst = rule({ start_date: '2026-01-01', interval_unit: 'day', cancellation_date: '2026-06-30', end_date: '2026-01-10' })
    expect(occurrenceDates(endedFirst, '2026-01-08', '2026-02-01')).toEqual(['2026-01-08', '2026-01-09', '2026-01-10'])
  })

  it('stops after payment_limit occurrences', () => {
    const r = rule({ start_date: '2026-01-15', payment_limit: 3 })
    expect(occurrenceDates(r, '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
    expect(nthOccurrence(r, 2)).toBe('2026-03-15')
    expect(nthOccurrence(r, 3)).toBeNull()
    expect(nextOccurrenceAfter(r, '2026-03-15')).toBeNull()
  })

  it('stops after one occurrence when auto_renew is off', () => {
    const r = rule({ start_date: '2026-01-15', auto_renew: false })
    expect(occurrenceDates(r, '2026-01-01', '2026-12-31')).toEqual(['2026-01-15'])
    expect(nthOccurrence(r, 1)).toBeNull()
  })

  it('rejects dates that the schedule never generates', () => {
    const r = rule({ start_date: '2026-01-31' })
    expect(occurrenceAllowed(r, '2026-03-15')).toBe(false)
    expect(occurrenceAllowed(r, '2026-02-28')).toBe(true)
    expect(occurrenceAllowed(r, '2025-12-31')).toBe(false)
  })

  it('ignores is_active — pausing is a status, not a schedule hole', () => {
    const r = rule({ start_date: '2026-01-31', is_active: false })
    expect(occurrenceDates(r, '2026-01-01', '2026-03-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('returns nothing when the window is inverted', () => {
    expect(occurrenceDates(rule({ start_date: '2026-01-31' }), '2026-05-01', '2026-01-01')).toEqual([])
  })
})

describe('nextOccurrenceAfter', () => {
  it('is strictly after the given date', () => {
    const r = rule({ start_date: '2026-01-31' })
    expect(nextOccurrenceAfter(r, '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrenceAfter(r, '2026-02-01')).toBe('2026-02-28')
  })

  it('finds the first occurrence from a date before the start', () => {
    expect(nextOccurrenceAfter(rule({ start_date: '2026-05-31' }), '2020-01-01')).toBe('2026-05-31')
  })

  it('returns null once the schedule is exhausted', () => {
    const r = rule({ start_date: '2026-01-15', end_date: '2026-03-15' })
    expect(nextOccurrenceAfter(r, '2026-02-01')).toBe('2026-02-15')
    expect(nextOccurrenceAfter(r, '2026-02-15')).toBe('2026-03-15')
    expect(nextOccurrenceAfter(r, '2026-03-15')).toBeNull()
  })
})

describe('nthOccurrence', () => {
  it('indexes from zero at the start date', () => {
    const r = rule({ start_date: '2026-01-31' })
    expect(nthOccurrence(r, 0)).toBe('2026-01-31')
    expect(nthOccurrence(r, 1)).toBe('2026-02-28')
    expect(nthOccurrence(r, 14)).toBe('2027-03-31')
  })

  it('rejects negative and boundary-exceeded indexes', () => {
    expect(nthOccurrence(rule({ start_date: '2026-01-31' }), -1)).toBeNull()
    expect(nthOccurrence(rule({ start_date: '2026-01-31', auto_renew: false }), 1)).toBeNull()
  })
})

describe('statusOf', () => {
  const march = { start_date: '2026-03-01', next_date: '2026-03-01' }

  it('marks an unpaid past occurrence overdue', () => {
    expect(statusOf(rule(march), '2026-03-05', new Set(), new Set())).toBe('overdue')
  })

  it('marks today as due today', () => {
    expect(statusOf(rule(march), '2026-03-01', new Set(), new Set())).toBe('due_today')
  })

  it('marks a future occurrence as scheduled', () => {
    expect(statusOf(rule(march), '2026-01-15', new Set(), new Set())).toBe('scheduled')
  })

  it('advances the cursor over paid and skipped occurrences', () => {
    const r = rule(march)
    expect(statusOf(r, '2026-03-05', new Set(['2026-03-01']), new Set())).toBe('scheduled')
    expect(statusOf(r, '2026-03-05', new Set(), new Set(['2026-03-01']))).toBe('scheduled')
    expect(statusOf(r, '2026-06-05', new Set(['2026-03-01', '2026-04-01']), new Set())).toBe('overdue')
  })

  it('reports paused without looking at dates', () => {
    expect(statusOf(rule({ ...march, is_active: false }), '2026-03-05', new Set(), new Set())).toBe('paused')
  })

  it('reports finished when the schedule has nothing left', () => {
    const exhausted = rule({ ...march, auto_renew: false })
    expect(statusOf(exhausted, '2026-03-05', new Set(['2026-03-01']), new Set())).toBe('finished')
    const pastEnd = rule({ ...march, end_date: '2026-03-01' })
    expect(statusOf(pastEnd, '2026-05-01', new Set(['2026-03-01']), new Set())).toBe('finished')
  })
})

describe('monthlyEquivalent', () => {
  it('converts each unit to an average calendar month', () => {
    expect(monthlyEquivalent(rule({ interval_unit: 'day', amount: '10' }))).toBe('304.38')
    expect(monthlyEquivalent(rule({ interval_unit: 'day', interval_value: 14, amount: '10' }))).toBe('21.74')
    expect(monthlyEquivalent(rule({ interval_unit: 'week', amount: '100' }))).toBe('434.82')
    expect(monthlyEquivalent(rule({ interval_unit: 'week', interval_value: 2, amount: '100' }))).toBe('217.41')
    expect(monthlyEquivalent(rule({ interval_unit: 'month', amount: '250' }))).toBe('250.00')
    expect(monthlyEquivalent(rule({ interval_unit: 'month', interval_value: 3, amount: '250' }))).toBe('83.33')
    expect(monthlyEquivalent(rule({ interval_unit: 'year', amount: '3600' }))).toBe('300.00')
    expect(monthlyEquivalent(rule({ interval_unit: 'year', interval_value: 2, amount: '1200' }))).toBe('50.00')
  })

  it('stays consistent when annualised back to twelve months', () => {
    expect(Number(monthlyEquivalent(rule({ interval_unit: 'year', amount: '3600' }))) * 12).toBe(3600)
  })

  it('rounds the exact decimal rather than a binary approximation', () => {
    expect(monthlyEquivalent(rule({ interval_unit: 'month', amount: '0.000000000001' }))).toBe('0.00')
    // (1.005).toFixed(2) in JS is '1.00'; the decimal-exact answer is '1.01'.
    expect(monthlyEquivalent(rule({ interval_unit: 'month', amount: '1.005' }))).toBe('1.01')
    expect(monthlyEquivalent(rule({ interval_unit: 'month', amount: '123456789.999999' }))).toBe('123456790.00')
  })
})

describe('legacy frequency rules', () => {
  const base = { next_date: '2026-01-05', start_date: null, is_active: true, amount: '50' }

  it('falls back to the old frequency column when the new fields are absent', () => {
    const legacy = { ...base, frequency: 'biweekly' }
    expect(occurrenceDates(legacy, '2026-01-01', '2026-02-28')).toEqual(['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16'])
  })

  it('maps daily, weekly, monthly and yearly to interval units', () => {
    expect(occurrenceDates({ ...base, frequency: 'daily' }, '2026-01-03', '2026-01-06')).toEqual(['2026-01-05', '2026-01-06'])
    expect(occurrenceDates({ ...base, frequency: 'weekly' }, '2026-01-05', '2026-01-26')).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'])
    expect(occurrenceDates({ ...base, frequency: 'monthly' }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'])
    expect(occurrenceDates({ ...base, frequency: 'yearly' }, '2026-01-01', '2028-12-31')).toEqual(['2026-01-05', '2027-01-05', '2028-01-05'])
  })

  it('keeps a drifted monthly anchor where the data puts it', () => {
    // A rule the old incremental cron moved from the 31st to the 28th stays on
    // the 28th until the user re-sets the anchor day.
    const drifted = { frequency: 'monthly', next_date: '2026-03-28', is_active: true, amount: '50' }
    expect(occurrenceDates(drifted, '2026-03-01', '2026-06-30')).toEqual(['2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28'])
  })
})

describe('toLegacyFrequency', () => {
  it('round-trips the five frequencies the 1.3.2 cron understood', () => {
    expect(toLegacyFrequency('day', 1)).toBe('daily')
    expect(toLegacyFrequency('week', 1)).toBe('weekly')
    expect(toLegacyFrequency('week', 2)).toBe('biweekly')
    expect(toLegacyFrequency('month', 1)).toBe('monthly')
    expect(toLegacyFrequency('year', 1)).toBe('yearly')
  })

  it('keeps the unit and drops the multiplier for intervals 1.3.2 cannot express', () => {
    // `frequency` is kept only so rolling the container back to finapp:1.3.2
    // still generates something; the exact interval lives in the new columns
    // and survives a re-upgrade.
    expect(toLegacyFrequency('day', 14)).toBe('daily')
    expect(toLegacyFrequency('month', 3)).toBe('monthly')
    expect(toLegacyFrequency('year', 2)).toBe('yearly')
  })

  it('falls back to monthly for an unknown unit', () => {
    expect(toLegacyFrequency('fortnight', 1)).toBe('monthly')
    expect(toLegacyFrequency(null, null)).toBe('monthly')
  })
})

describe('initialNextDate', () => {
  it('returns the first occurrence on or after today', () => {
    expect(initialNextDate(rule({ start_date: '2026-01-31' }), '2026-03-05')).toBe('2026-03-31')
    expect(initialNextDate(rule({ start_date: '2026-01-31' }), '2026-03-31')).toBe('2026-03-31')
  })

  it('keeps a start date that has not happened yet', () => {
    expect(initialNextDate(rule({ start_date: '2026-05-31' }), '2026-01-01')).toBe('2026-05-31')
  })

  it('returns null once the schedule is exhausted', () => {
    const ended = rule({ start_date: '2026-01-15', end_date: '2026-03-15' })
    expect(initialNextDate(ended, '2026-06-01')).toBeNull()
    expect(initialNextDate(rule({ start_date: '2026-01-15', payment_limit: 1 }), '2026-06-01')).toBeNull()
    expect(initialNextDate(rule({ start_date: '2026-01-15', auto_renew: false }), '2026-06-01')).toBeNull()
  })

  it('derives from the legacy frequency when the new fields are absent', () => {
    const legacy = { frequency: 'weekly', next_date: '2026-01-05', is_active: true }
    expect(initialNextDate(legacy, '2026-01-08')).toBe('2026-01-12')
  })
})

describe('resolveProjectionWindow', () => {
  it('accepts a window of at most 400 calendar days inclusive', () => {
    expect(resolveProjectionWindow('2026-01-01', '2026-02-09')).toEqual({ ok: true, from: '2026-01-01', to: '2026-02-09' })
    expect(resolveProjectionWindow('2026-01-01', '2027-02-04').ok).toBe(true)
  })

  it('rejects a window one day longer than the cap', () => {
    expect(resolveProjectionWindow('2026-01-01', '2027-02-05')).toEqual({ ok: false, error: 'invalid_date_range' })
  })

  it('rejects inverted windows and bounds that are not real dates', () => {
    expect(resolveProjectionWindow('2026-03-01', '2026-01-01').ok).toBe(false)
    expect(resolveProjectionWindow('2026-13-01', '2027-01-01').ok).toBe(false)
    expect(resolveProjectionWindow('2026-02-30', '2026-03-01').ok).toBe(false)
    expect(resolveProjectionWindow(null, null).ok).toBe(false)
  })

  it('keeps a single-day window', () => {
    expect(resolveProjectionWindow('2026-05-05', '2026-05-05')).toEqual({ ok: true, from: '2026-05-05', to: '2026-05-05' })
  })
})

describe('buildSchedulePatch', () => {
  it('collects only whitelisted, defined columns', () => {
    const { fields, values } = buildSchedulePatch({ amount: '25', is_active: false, bogus: 'x', note: undefined })
    expect(fields).toEqual(['amount = $1', 'is_active = $2'])
    expect(values).toEqual(['25', false])
  })

  it('lets a nullable column be cleared with null', () => {
    const { fields, values } = buildSchedulePatch({ end_date: null, payment_limit: null })
    expect(fields).toEqual(['end_date = $1', 'payment_limit = $2'])
    expect(values).toEqual([null, null])
  })

  it('reports an empty patch instead of building invalid SQL', () => {
    expect(buildSchedulePatch({})).toEqual({ fields: [], values: [], empty: true })
    expect(buildSchedulePatch({ nothing_whitelisted: 1 }).empty).toBe(true)
  })

  it('keeps a stable column order regardless of key insertion order', () => {
    const a = buildSchedulePatch({ amount: 1, account_id: 2, currency: 'USD' })
    const b = buildSchedulePatch({ currency: 'USD', amount: 1, account_id: 2 })
    expect(a.fields).toEqual(b.fields)
  })

  it('refuses to hand-set next_date — the cursor is derived from the schedule', () => {
    expect(buildSchedulePatch({ next_date: '2026-01-01' }).empty).toBe(true)
  })
})

describe('frequencyToSchedule', () => {
  it('maps each legacy frequency to a unit and multiplier', () => {
    expect(frequencyToSchedule('daily')).toEqual({ unit: 'day', value: 1 })
    expect(frequencyToSchedule('weekly')).toEqual({ unit: 'week', value: 1 })
    expect(frequencyToSchedule('biweekly')).toEqual({ unit: 'week', value: 2 })
    expect(frequencyToSchedule('monthly')).toEqual({ unit: 'month', value: 1 })
    expect(frequencyToSchedule('yearly')).toEqual({ unit: 'year', value: 1 })
  })

  it('returns null for anything the old column never meant', () => {
    expect(frequencyToSchedule('fortnightly')).toBeNull()
    expect(frequencyToSchedule(undefined)).toBeNull()
  })
})

describe('dueOccurrence', () => {
  it('reports the stored cursor while it is unpaid', () => {
    const r = rule({ start_date: '2026-03-01', next_date: '2026-03-01' })
    expect(dueOccurrence(r, '2026-03-05', new Set(), new Set())).toBe('2026-03-01')
  })

  it('walks past paid and skipped occurrences', () => {
    const r = rule({ start_date: '2026-03-01', next_date: '2026-03-01' })
    expect(dueOccurrence(r, '2026-03-05', new Set(['2026-03-01']), new Set())).toBe('2026-04-01')
    expect(dueOccurrence(r, '2026-03-05', new Set(), new Set(['2026-03-01']))).toBe('2026-04-01')
  })

  it('returns null once nothing is left', () => {
    const r = rule({ start_date: '2026-03-01', next_date: '2026-03-01', auto_renew: false })
    expect(dueOccurrence(r, '2026-03-05', new Set(['2026-03-01']), new Set())).toBeNull()
  })

  it('still reports a cursor for a paused rule — paying one occurrence by hand stays possible', () => {
    const r = rule({ start_date: '2026-03-01', next_date: '2026-03-01', is_active: false })
    expect(dueOccurrence(r, '2026-03-05', new Set(), new Set())).toBe('2026-03-01')
  })
})

describe('planRuleRun', () => {
  it('creates every missed occurrence and parks the cursor in the future', () => {
    const plan = planRuleRun(rule({ next_date: '2026-01-31' }), '2026-03-31')
    expect(plan.toCreate).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(plan.rewound).toEqual([])
    expect(plan.nextDate).toBe('2026-04-30')
    expect(plan.finished).toBe(false)
  })

  it('keeps the catch-up cap and reports what it had to rewind', () => {
    const plan = planRuleRun(rule({ interval_unit: 'day', start_date: '2026-01-01', next_date: '2026-01-01' }), '2026-01-30', { limit: 10 })
    expect(plan.toCreate.length).toBe(10)
    expect(plan.toCreate[0]).toBe('2026-01-01')
    expect(plan.rewound[0]).toBe('2026-01-11')
    expect(plan.rewound.length).toBe(20)
    expect(plan.rewound[19]).toBe('2026-01-30')
    expect(plan.nextDate).toBe('2026-01-31')
  })

  it('does not create a skipped occurrence but still advances past it', () => {
    const plan = planRuleRun(rule({ next_date: '2026-01-31' }), '2026-03-31', { skipped: new Set(['2026-02-28']) })
    expect(plan.toCreate).toEqual(['2026-01-31', '2026-03-31'])
    expect(plan.rewound).toEqual([])
  })

  it('treats an already-paid date as settled', () => {
    const plan = planRuleRun(rule({ next_date: '2026-01-31' }), '2026-02-28', { paid: new Set(['2026-01-31']) })
    expect(plan.toCreate).toEqual(['2026-02-28'])
    expect(plan.nextDate).toBe('2026-03-31')
  })

  it('finishes on the end date and parks the cursor on the last allowed day', () => {
    const plan = planRuleRun(rule({ next_date: '2026-01-31', end_date: '2026-03-01' }), '2026-06-30')
    expect(plan.toCreate).toEqual(['2026-01-31', '2026-02-28'])
    expect(plan.finished).toBe(true)
    expect(plan.lastDate).toBe('2026-02-28')
    expect(plan.nextDate).toBe('2026-02-28')
  })

  it('stops at the payment limit', () => {
    const plan = planRuleRun(rule({ payment_limit: 2, next_date: '2026-01-31' }), '2026-12-31')
    expect(plan.toCreate).toEqual(['2026-01-31', '2026-02-28'])
    expect(plan.finished).toBe(true)
  })

  it('pays a non-renewing rule once and is done', () => {
    const plan = planRuleRun(rule({ auto_renew: false, next_date: '2026-01-31' }), '2026-05-31')
    expect(plan.toCreate).toEqual(['2026-01-31'])
    expect(plan.finished).toBe(true)
    expect(plan.lastDate).toBe('2026-01-31')
  })

  it('snaps a stored cursor that no longer fits the schedule', () => {
    const plan = planRuleRun(
      rule({ billing_anchor_day: 15, start_date: '2026-01-15', next_date: '2026-01-31' }),
      '2026-03-31'
    )
    expect(plan.toCreate).toEqual(['2026-02-15', '2026-03-15'])
    expect(plan.nextDate).toBe('2026-04-15')
  })

  it('leaves a rule that is not due yet untouched', () => {
    const plan = planRuleRun(rule({ next_date: '2026-05-31' }), '2026-03-31')
    expect(plan.toCreate).toEqual([])
    expect(plan.rewound).toEqual([])
    expect(plan.nextDate).toBe('2026-05-31')
    expect(plan.finished).toBe(false)
  })

  it('reports an exhausted schedule instead of looping', () => {
    const plan = planRuleRun(rule({ next_date: null, start_date: '2026-01-31', payment_limit: 0, end_date: '2026-01-01' }), '2026-06-30')
    expect(plan.toCreate).toEqual([])
    expect(plan.finished).toBe(true)
    expect(plan.nextDate).toBe(null)
  })
})

describe('projectOccurrences', () => {
  const rent = rule({ id: 1, note: 'Rent', category_name: 'Housing', account_name: 'Checking', start_date: '2026-01-31' })
  const salary = rule({
    id: 2,
    type: 'income',
    amount: '2500.000000000000',
    note: 'Payday',
    start_date: '2026-01-05',
    billing_anchor_day: 5,
    interval_value: 1
  })

  it('flattens every rule into one date-ordered list', () => {
    const rows = projectOccurrences([rent, salary], {}, '2026-02-01', '2026-03-31')
    expect(rows.map(o => `${o.rule_id}:${o.date}`)).toEqual(['2:2026-02-05', '1:2026-02-28', '2:2026-03-05', '1:2026-03-31'])
  })

  it('orders same-day occurrences by rule id', () => {
    const rows = projectOccurrences([salary, rent], {}, '2026-01-01', '2026-01-31')
    expect(rows.filter(o => o.date === '2026-01-31').map(o => o.rule_id)).toEqual([1])
    expect(rows[0].date <= rows[rows.length - 1].date).toBe(true)
  })

  it('labels an occurrence from the rule note, then category, then account', () => {
    const rows = projectOccurrences(
      [rule({ id: 3, note: null, category_name: 'Food', account_name: 'Card' }), rule({ id: 4, note: 'Gym', category_name: null, account_name: 'Card' })],
      {},
      '2026-01-01',
      '2026-01-31'
    )
    expect(rows.find(o => o.rule_id === 3).name).toBe('Food')
    expect(rows.find(o => o.rule_id === 4).name).toBe('Gym')
  })

  it('carries paid and skipped flags from the exception maps', () => {
    const flags = {
      paid: new Map([[1, new Set(['2026-02-28'])]]),
      skipped: new Map([[1, new Set(['2026-03-31'])]])
    }
    const rows = projectOccurrences([rent], flags, '2026-02-01', '2026-03-31')
    expect(rows.find(o => o.date === '2026-02-28').paid).toBe(true)
    expect(rows.find(o => o.date === '2026-02-28').skipped).toBe(false)
    expect(rows.find(o => o.date === '2026-03-31').skipped).toBe(true)
  })

  it('keeps amounts as the numeric strings pg returns', () => {
    const [row] = projectOccurrences([rent], {}, '2026-02-01', '2026-02-28')
    expect(row.amount).toBe('100.000000000000')
    expect(typeof row.amount).toBe('string')
  })

  it('carries the owning user so a shared rule keeps unique calendar UIDs', () => {
    const rows = projectOccurrences([rule({ id: 7, user_id: 42 })], {}, '2026-01-01', '2026-01-31')
    expect(rows[0].user_id).toBe(42)
  })

  it('contributes nothing for a window past the end date or the payment limit', () => {
    expect(projectOccurrences([rule({ id: 5, start_date: '2026-01-31', end_date: '2026-02-01' })], {}, '2026-03-01', '2026-06-30')).toEqual([])
    expect(projectOccurrences([rule({ id: 6, start_date: '2026-01-31', payment_limit: 1 })], {}, '2026-03-01', '2026-06-30')).toEqual([])
  })

  it('returns an empty list for an inverted window', () => {
    expect(projectOccurrences([rent], {}, '2026-04-01', '2026-01-01')).toEqual([])
  })
})
