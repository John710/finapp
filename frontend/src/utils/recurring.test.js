import { describe, it, expect } from 'vitest'
import { scheduleLabel, feedUrl } from './recurring'

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

describe('feedUrl', () => {
  it('points a calendar client at the token-authenticated feed', () => {
    expect(feedUrl('3f2b1c9a-7d4e-4c1b-9a6f-0e2d5b8c1a44', 'https://fin.example.test'))
      .toBe('https://fin.example.test/api/v1/recurring.ics?token=3f2b1c9a-7d4e-4c1b-9a6f-0e2d5b8c1a44')
  })

  it('escapes the token instead of trusting its shape', () => {
    expect(feedUrl('a b&c', 'https://fin.example.test'))
      .toBe('https://fin.example.test/api/v1/recurring.ics?token=a%20b%26c')
  })

  it('has no trailing slash to duplicate when the origin carries one', () => {
    expect(feedUrl('t', 'https://fin.example.test/'))
      .toBe('https://fin.example.test/api/v1/recurring.ics?token=t')
  })
})
