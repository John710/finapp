import { describe, it, expect } from 'vitest'
import { scheduleLabel } from './recurring'

function makeT(messages) {
  return (key, named = {}) => {
    const raw = key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), messages)
    if (typeof raw !== 'string') return key
    return raw.replace(/\{(\w+)\}/g, (_, name) => String(named[name]))
  }
}

const enT = makeT({
  recurring: {
    frequencies: { daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly' },
    interval: {
      every: {
        day: 'Every {count} days',
        week: 'Every {count} weeks',
        month: 'Every {count} months',
        year: 'Every {count} years'
      }
    }
  }
})

describe('scheduleLabel', () => {
  it('uses the single-word frequency for a step of one', () => {
    expect(scheduleLabel(enT, { interval_unit: 'month', interval_value: 1 })).toBe('Monthly')
    expect(scheduleLabel(enT, { interval_unit: 'day', interval_value: 1 })).toBe('Daily')
    expect(scheduleLabel(enT, { interval_unit: 'year', interval_value: 1 })).toBe('Yearly')
  })

  it('spells out a repeated interval per unit', () => {
    expect(scheduleLabel(enT, { interval_unit: 'day', interval_value: 14 })).toBe('Every 14 days')
    expect(scheduleLabel(enT, { interval_unit: 'week', interval_value: 2 })).toBe('Every 2 weeks')
    expect(scheduleLabel(enT, { interval_unit: 'month', interval_value: 3 })).toBe('Every 3 months')
    expect(scheduleLabel(enT, { interval_unit: 'year', interval_value: 6 })).toBe('Every 6 years')
  })

  it('falls back to a monthly schedule for legacy rows without interval columns', () => {
    expect(scheduleLabel(enT, {})).toBe('Monthly')
    expect(scheduleLabel(enT, null)).toBe('Monthly')
  })
})
