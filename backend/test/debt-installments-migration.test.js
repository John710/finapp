import { describe, it, expect } from 'vitest'
import { up, down } from '../migrations/0000000000038_debt_installments.js'

// No PostgreSQL locally: the test records what the migration asks
// node-pg-migrate to do and pins the schema of spec §2.1.
function recordingPgm() {
  const steps = []
  return {
    steps,
    func: text => ({ func: text }),
    createTable: (table, columns) => steps.push({ kind: 'createTable', table, columns }),
    addConstraint: (table, name, options) => steps.push({ kind: 'constraint', table, name, options }),
    createIndex: (table, columns, options) => steps.push({ kind: 'index', table, columns, options }),
    addColumn: (table, columns) => steps.push({ kind: 'addColumn', table, columns }),
    dropColumn: (table, column) => steps.push({ kind: 'dropColumn', table, column }),
    dropTable: table => steps.push({ kind: 'dropTable', table })
  }
}

describe('migration 38: debt installments', () => {
  it('creates the table with its foreign keys and checks', () => {
    const pgm = recordingPgm()
    up(pgm)
    const create = pgm.steps.find(s => s.kind === 'createTable')
    expect(create.table).toBe('debt_installments')
    const c = create.columns
    expect(c.debt_id).toMatchObject({ type: 'integer', notNull: true, references: 'debts', onDelete: 'CASCADE' })
    expect(c.user_id).toMatchObject({ type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' })
    expect(c.position).toMatchObject({ type: 'integer', notNull: true })
    expect(c.due_date).toMatchObject({ type: 'date', notNull: true })
    expect(c.amount).toMatchObject({ type: 'numeric(24,12)', notNull: true, check: 'amount > 0' })
    expect(c.status).toMatchObject({ type: 'varchar(10)', notNull: true, default: 'due' })
    expect(c.status.check).toBe("status IN ('due', 'paid', 'skipped')")
    expect(c.paid_on).toEqual({ type: 'date' })
    expect(c.note).toEqual({ type: 'text' })
    expect(c.created_at).toMatchObject({ type: 'timestamp', notNull: true })
    expect(c.updated_at).toMatchObject({ type: 'timestamp', notNull: true })
  })

  it('adds both UNIQUE constraints and the two calendar indexes', () => {
    const pgm = recordingPgm()
    up(pgm)
    const uniques = pgm.steps.filter(s => s.kind === 'constraint').map(s => s.options.unique)
    expect(uniques).toEqual([['debt_id', 'position'], ['debt_id', 'due_date']])
    const indexes = pgm.steps.filter(s => s.kind === 'index')
    expect(indexes.map(s => [s.table, s.columns, s.options.where ?? null])).toEqual([
      ['debt_installments', ['user_id', 'due_date'], null],
      ['debt_installments', ['due_date'], "status = 'due'"]
    ])
  })

  it('links payments to installments with ON DELETE SET NULL, after the table exists', () => {
    const pgm = recordingPgm()
    up(pgm)
    const add = pgm.steps.findIndex(s => s.kind === 'addColumn')
    expect(add).toBeGreaterThan(pgm.steps.findIndex(s => s.kind === 'createTable'))
    expect(pgm.steps[add].table).toBe('debt_payments')
    expect(pgm.steps[add].columns.installment_id).toEqual({
      type: 'integer', references: 'debt_installments', onDelete: 'SET NULL'
    })
  })

  it('down drops the column first, then the table', () => {
    const pgm = recordingPgm()
    down(pgm)
    expect(pgm.steps).toEqual([
      { kind: 'dropColumn', table: 'debt_payments', column: 'installment_id' },
      { kind: 'dropTable', table: 'debt_installments' }
    ])
  })
})
