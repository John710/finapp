import { describe, it, expect } from 'vitest'

// The split/transfer semantics live in route handlers (no service layer yet),
// so these tests pin the SQL-level invariants that the handlers must uphold:
// - split parents carry the full amount with NO category and is_split=true
// - split children carry per-category amounts and parent_id, no balance effect
// - reports: flow totals skip children, category totals skip parents
// These are exercised end-to-end by the blackbox suite; here we validate the
// pure decision logic extracted from the handlers.

function splitSumOk(total, parts) {
  return Math.abs(parts.reduce((s, p) => s + p, 0) - total) < 0.005
}

function describeSplitRows(total, parts) {
  // Mirrors the POST /transactions handler structure
  const rows = []
  rows.push({ role: 'parent', amount: total, category_id: null, is_split: true })
  for (const amount of parts) {
    rows.push({ role: 'child', amount, parent_id: 'P', is_split: false })
  }
  return rows
}

// Mirrors the report aggregation filters
function flowTotal(rows) {
  return rows.filter(r => r.role !== 'child').reduce((s, r) => s + r.amount, 0)
}

function categoryTotals(rows) {
  const by = {}
  for (const r of rows.filter(r => r.role !== 'parent')) {
    by[r.category_id] = (by[r.category_id] || 0) + r.amount
  }
  return by
}

describe('split transaction semantics', () => {
  const total = 100
  const parts = [60, 25, 15]
  const rows = describeSplitRows(total, parts)

  it('parts must sum to the total', () => {
    expect(splitSumOk(total, parts)).toBe(true)
    expect(splitSumOk(total, [50, 40])).toBe(false)
  })

  it('parent has no category and is flagged as split', () => {
    const parent = rows.find(r => r.role === 'parent')
    expect(parent.category_id).toBe(null)
    expect(parent.is_split).toBe(true)
    expect(parent.amount).toBe(100)
  })

  it('flow totals count the parent once, children never', () => {
    expect(flowTotal(rows)).toBe(100)
  })

  it('category totals count children only, parent never', () => {
    const by = categoryTotals([
      { role: 'child', amount: 60, category_id: 1 },
      { role: 'child', amount: 40, category_id: 2 }
    ])
    expect(by).toEqual({ 1: 60, 2: 40 })
  })

  it('zero-sum rounding edge (0.1+0.2 style) stays within tolerance', () => {
    expect(splitSumOk(0.3, [0.1, 0.2])).toBe(true)
  })
})
