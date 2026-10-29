import { describe, it, expect } from 'vitest'
import { up, down } from '../migrations/0000000000039_debt_auto_paid.js'

// No PostgreSQL locally: the test records what the migration asks
// node-pg-migrate to do.
function recordingPgm() {
  const steps = []
  return {
    steps,
    addColumn: (table, columns) => steps.push({ kind: 'addColumn', table, columns }),
    dropColumn: (table, column) => steps.push({ kind: 'dropColumn', table, column }),
    sql: text => steps.push({ kind: 'sql', text: text.replace(/\s+/g, ' ').trim() })
  }
}

describe('migration 39: debts.auto_paid', () => {
  it('adds a NOT NULL boolean defaulting to false, then backfills paid debts that have payments', () => {
    const pgm = recordingPgm()
    up(pgm)
    expect(pgm.steps.map(s => s.kind)).toEqual(['addColumn', 'sql'])
    expect(pgm.steps[0].table).toBe('debts')
    expect(pgm.steps[0].columns).toEqual({ auto_paid: { type: 'boolean', notNull: true, default: false } })
    expect(pgm.steps[1].text).toBe(
      "UPDATE debts d SET auto_paid = true WHERE d.status = 'paid' AND EXISTS (SELECT 1 FROM debt_payments p WHERE p.debt_id = d.id)"
    )
  })

  it('drops the column on the way down', () => {
    const pgm = recordingPgm()
    down(pgm)
    expect(pgm.steps).toEqual([{ kind: 'dropColumn', table: 'debts', column: 'auto_paid' }])
  })
})
