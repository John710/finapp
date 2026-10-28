import { describe, it, expect } from 'vitest'
import { up } from '../migrations/0000000000032_recurring_occurrence_integrity.js'

// v1.3.2 deleted rules without clearing transactions.recurring_rule_id and could
// book one occurrence twice, so on real 1.3.x databases the FK and the unique
// (recurring_rule_id, date) index of migration 32 failed and the container
// crash-looped. No PostgreSQL locally: the test pins that the clean-up runs
// first, only unlinks, and matches nothing on an already consistent database.
function recordingPgm() {
  const steps = []
  return {
    steps,
    sql: text => steps.push({ kind: 'sql', text: text.replace(/\s+/g, ' ').trim() }),
    addConstraint: (table, name) => steps.push({ kind: 'constraint', table, name }),
    createIndex: (table, columns, options) => steps.push({ kind: 'index', table, name: options.name })
  }
}

describe('migration 32 clean-up before the integrity constraints', () => {
  it('unlinks orphans and duplicates before adding the FK and the unique index', () => {
    const pgm = recordingPgm()
    up(pgm)
    expect(pgm.steps.map(step => step.kind)).toEqual(['sql', 'sql', 'constraint', 'index'])
    expect(pgm.steps[2].name).toBe('transactions_recurring_rule_fkey')
    expect(pgm.steps[3].name).toBe('transactions_recurring_occ_uniq')
  })

  it('clears only links to rules that no longer exist', () => {
    const pgm = recordingPgm()
    up(pgm)
    const sql = pgm.steps[0].text
    expect(sql).toMatch(/^UPDATE transactions t SET recurring_rule_id = NULL/)
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM recurring_rules r WHERE r.id = t.recurring_rule_id)')
  })

  it('keeps the lowest id of each (rule, date) linked and unlinks the rest', () => {
    const pgm = recordingPgm()
    up(pgm)
    const sql = pgm.steps[1].text
    expect(sql).toMatch(/^UPDATE transactions t SET recurring_rule_id = NULL/)
    expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY recurring_rule_id, date ORDER BY id)')
    expect(sql).toContain('d.rn > 1')
  })

  it('never deletes a transaction or touches an amount or balance', () => {
    const pgm = recordingPgm()
    up(pgm)
    for (const step of pgm.steps.filter(s => s.kind === 'sql')) {
      expect(step.text).not.toMatch(/DELETE|amount|balance/i)
    }
  })
})
