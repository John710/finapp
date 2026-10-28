import { describe, it, expect } from 'vitest'
import { up, down } from '../migrations/0000000000035_recurring_start_date_from_history.js'

// Migration 31 seeded start_date/billing_anchor_day from next_date, which is the
// already advanced ledger cursor — so every rule that predates 1.4 lost the
// months it had already billed. This migration reconciles those columns with the
// transactions the ledger actually holds. No PostgreSQL locally, so the test pins
// the statements' guard: the repair must only touch rows the ledger contradicts.
function recordingPgm() {
  const statements = []
  return {
    statements,
    sql: text => statements.push(text),
    func: expression => `pgm.func(${expression})`
  }
}

const normalize = text => text.replace(/\s+/g, ' ').trim()

describe('recurring start_date backfill from history', () => {
  it('pulls start_date down to the first booked occurrence, never earlier', () => {
    const pgm = recordingPgm()
    up(pgm)
    const dates = pgm.statements.filter(statement => /start_date/.test(statement))
    expect(dates).toHaveLength(1)
    const sql = normalize(dates[0])
    expect(sql).toContain('MIN(t.date)')
    expect(sql).toContain('r.start_date > l.first_date')
    expect(sql).toContain('FROM transactions t')
  })

  it('re-derives the anchor day from the widest booked day for month and year rules', () => {
    const pgm = recordingPgm()
    up(pgm)
    const sql = normalize(pgm.statements.find(statement => /start_date/.test(statement)))
    expect(sql).toContain("interval_unit IN ('month', 'year')")
    expect(sql).toContain('MAX(')
    expect(sql).toContain('EXTRACT(DAY FROM t.date)')
  })

  it('recounts occurrences_paid from the ledger instead of trusting the counter', () => {
    const pgm = recordingPgm()
    up(pgm)
    const counts = pgm.statements.filter(statement => /occurrences_paid/.test(statement))
    expect(counts).toHaveLength(1)
    const sql = normalize(counts[0])
    expect(sql).toContain('COUNT(*)')
    expect(sql).toContain('r.occurrences_paid <> l.booked')
  })

  it('leaves rows whose schedule already reaches their history untouched', () => {
    const pgm = recordingPgm()
    up(pgm)
    for (const statement of pgm.statements) {
      const sql = normalize(statement)
      if (/UPDATE recurring_rules/.test(sql)) {
        expect(sql).toMatch(/WHERE .*l\.rule_id = r\.id AND r\.(start_date > l\.first_date|occurrences_paid <> l\.booked)/)
      }
    }
    expect(pgm.statements).toHaveLength(2)
  })

  it('has no reversible down: 1.3 ignores the columns it would restore', () => {
    const pgm = recordingPgm()
    down(pgm)
    expect(pgm.statements).toHaveLength(0)
  })
})
