import { describe, it, expect } from 'vitest'
import { up, down } from '../migrations/0000000000036_audit_indexes.js'

function recordingPgm() {
  const statements = []
  return { statements, sql: text => statements.push(text) }
}

const EXPECTED = [
  'transactions (account_id, date DESC)',
  'transactions (transfer_to_account_id)',
  'exchange_rates (from_currency, to_currency, updated_at DESC)',
  'notifications (user_id, created_at DESC)',
  'debt_payments (debt_id)',
  'budgets (category_id)',
  'budget_tags (tag_id)',
  'recurring_rules (account_id)',
  'debts (account_id)'
]

describe('migration 36: audit indexes', () => {
  it('creates every index idempotently and widens the rate column', () => {
    const pgm = recordingPgm()
    up(pgm)
    const creates = pgm.statements.filter(s => s.startsWith('CREATE INDEX'))
    expect(creates).toHaveLength(EXPECTED.length)
    for (const target of EXPECTED) {
      expect(creates.some(s => s.startsWith('CREATE INDEX IF NOT EXISTS') && s.endsWith(`ON ${target}`))).toBe(true)
    }
    expect(pgm.statements).toContain('ALTER TABLE exchange_rates ALTER COLUMN rate TYPE numeric(30,18)')
  })

  it('down restores the column and drops exactly the indexes up created', () => {
    const upPgm = recordingPgm()
    up(upPgm)
    const created = upPgm.statements
      .filter(s => s.startsWith('CREATE INDEX'))
      .map(s => s.match(/IF NOT EXISTS (\S+) ON/)[1])

    const downPgm = recordingPgm()
    down(downPgm)
    expect(downPgm.statements[0]).toBe('ALTER TABLE exchange_rates ALTER COLUMN rate TYPE numeric(15,6)')
    const dropped = downPgm.statements
      .filter(s => s.startsWith('DROP INDEX IF EXISTS'))
      .map(s => s.replace('DROP INDEX IF EXISTS ', ''))
    expect(dropped.sort()).toEqual(created.sort())
  })
})
