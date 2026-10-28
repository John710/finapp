import { describe, it, expect } from 'vitest'
import { buildFeed } from '../services/ical.js'

// The feed is consumed by calendar clients, not by our own UI, so the contract
// that matters is RFC 5545: CRLF endings, 75-octet folding, escaped text and a
// UID that stays identical between refreshes (a changed UID duplicates events).

function occurrence(overrides = {}) {
  return {
    rule_id: 11,
    user_id: 7,
    name: 'Netflix',
    date: '2026-11-03',
    amount: '15.990000000000',
    currency: 'EUR',
    type: 'expense',
    account_name: 'Main card',
    paid: false,
    skipped: false,
    is_active: true,
    ...overrides
  }
}

const opts = { calendarName: 'FinApp subscriptions', uidHost: 'finapp.example', generatedAt: '2026-10-28T09:00:00Z' }

describe('buildFeed', () => {
  it('wraps the events in a VCALENDAR envelope', () => {
    const text = buildFeed([occurrence()], opts)
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('VERSION:2.0')
    expect(text).toContain('PRODID:-//FinApp//Recurring//EN')
    expect(text).toContain('CALSCALE:GREGORIAN')
    expect(text).toContain('METHOD:PUBLISH')
    expect(text).toContain('BEGIN:VEVENT')
    expect(text).toContain('END:VEVENT')
  })

  it('uses CRLF everywhere and never a bare newline', () => {
    const text = buildFeed([occurrence(), occurrence({ rule_id: 12 })], opts)
    expect(text.includes('\n\r')).toBe(false)
    const withoutCrlf = text.replace(/\r\n/g, '')
    expect(withoutCrlf.includes('\n')).toBe(false)
    expect(withoutCrlf.includes('\r')).toBe(false)
  })

  it('emits all-day dates without RRULE', () => {
    const text = buildFeed([occurrence()], opts)
    expect(text).toContain('DTSTART;VALUE=DATE:20261103')
    expect(text).toContain('DTEND;VALUE=DATE:20261104')
    expect(text).not.toContain('RRULE')
    expect(text).toContain('DTSTAMP:20261028T090000Z')
  })

  it('keeps the UID stable for the same rule occurrence', () => {
    const first = buildFeed([occurrence()], opts)
    const second = buildFeed([occurrence()], { ...opts, generatedAt: '2026-10-29T09:00:00Z' })
    const uid = line => line.match(/^UID:(.*)$/m)[1]
    expect(uid(second)).toBe(uid(first))
    expect(uid(first)).toContain('11-2026-11-03')
    expect(uid(first)).toContain('finapp.example')
  })

  it('gives every occurrence its own event', () => {
    const text = buildFeed([
      occurrence({ date: '2026-11-03' }),
      occurrence({ date: '2026-12-03' }),
      occurrence({ rule_id: 12, date: '2026-11-03' })
    ], opts)
    expect(text.split('BEGIN:VEVENT').length - 1).toBe(3)
  })

  it('escapes the characters RFC 5545 reserves in TEXT values', () => {
    const text = buildFeed([occurrence({ name: 'Groceries, milk; eggs\nand \\more' })], opts)
    const summary = text.split('\r\n').find(line => line.startsWith('SUMMARY:'))
    expect(summary).toBe('SUMMARY:Groceries\\, milk\\; eggs\\nand \\\\more')
  })

  it('folds lines longer than 75 octets', () => {
    const text = buildFeed([occurrence({ name: 'A'.repeat(200) })], opts)
    for (const line of text.split('\r\n')) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    }
    // A folded continuation starts with a space and the value survives intact.
    expect(text.replace(/\r\n /g, '')).toContain('SUMMARY:' + 'A'.repeat(200))
  })

  it('leaves out occurrences the user skipped', () => {
    const text = buildFeed([occurrence(), occurrence({ rule_id: 12, skipped: true })], opts)
    expect(text.split('BEGIN:VEVENT').length - 1).toBe(1)
    expect(text).not.toContain('12-')
  })

  it('marks paid occurrences so a refresh does not hide them', () => {
    const text = buildFeed([occurrence({ paid: true })], opts)
    expect(text.split('BEGIN:VEVENT').length - 1).toBe(1)
    expect(text).toContain('STATUS:CONFIRMED')
    expect(text).toContain('X-FINAPP-PAID:20261103')
  })

  it('carries the amount as a comment so the entry stays readable', () => {
    const text = buildFeed([occurrence()], opts)
    const description = text.split('\r\n').find(line => line.startsWith('DESCRIPTION:'))
    expect(description).toContain('15.99')
    expect(description).toContain('EUR')
    expect(description).toContain('Main card')
  })

  it('trims trailing zeros out of the amount instead of rounding', () => {
    const text = buildFeed([occurrence({ amount: '120.000000000000' })], opts)
    expect(text).toContain('120')
    expect(text).not.toContain('120.0000')
  })

  it('labels income occurrences differently from bills', () => {
    const bills = buildFeed([occurrence()], opts)
    const salary = buildFeed([occurrence({ type: 'income', name: 'Salary' })], opts)
    expect(salary).toContain('SUMMARY:Salary')
    expect(salary).not.toBe(bills)
  })

  it('returns an empty calendar for no occurrences', () => {
    const text = buildFeed([], opts)
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).not.toContain('BEGIN:VEVENT')
  })

  it('publishes the calendar name clients show in their list', () => {
    const text = buildFeed([], opts)
    expect(text).toContain('X-WR-CALNAME:FinApp subscriptions')
  })

  it('refuses a feed window without dates', () => {
    expect(buildFeed([occurrence({ date: null })], opts)).not.toContain('BEGIN:VEVENT')
  })
})
