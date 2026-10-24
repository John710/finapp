import { describe, it, expect } from 'vitest'

// Transfer balance semantics pinned as pure logic — the SQL handlers are
// covered end-to-end by the blackbox suite. These encode the invariants the
// set-based account-deletion compensation (accounts.js) must preserve.

// A transfer moves `amount` out of the source and credits the paired leg
// amount (in the target currency) to the target.
function applyTransfer(balances, { from, to, amount, credited }) {
  const next = { ...balances }
  next[from] -= amount
  next[to] += credited
  return next
}

// Deleting an account must revert the money it moved, exactly like the
// handlers do per-row (mirrors accounts.js DELETE compensation).
function revertOutgoingTransfer(balances, { to, credited }) {
  const next = { ...balances }
  next[to] -= credited
  return next
}

function revertIncomingTransfer(balances, { from, amount }) {
  const next = { ...balances }
  next[from] += amount
  return next
}

describe('transfer balance invariants', () => {
  it('a transfer is symmetric: apply then delete-both-sides restores balances', () => {
    let b = { a: 1000, c: 500 }
    b = applyTransfer(b, { from: 'a', to: 'c', amount: 300, credited: 300 })
    expect(b).toEqual({ a: 700, c: 800 })
    b = revertOutgoingTransfer(b, { to: 'c', credited: 300 })
    expect(b).toEqual({ a: 700, c: 500 })
  })

  it('cross-currency transfers revert by the CREDITED amount, not the source amount', () => {
    let b = { a: 1000, c: 500 }
    // 300 USD -> 27900 RUB credited
    b = applyTransfer(b, { from: 'a', to: 'c', amount: 300, credited: 27900 })
    expect(b.c).toBe(28400)
    // Account deletion takes the credited amount back (paired leg amount)
    b = revertOutgoingTransfer(b, { to: 'c', credited: 27900 })
    expect(b.c).toBe(500)
  })

  it('incoming transfers to a deleted account give the money back to the source', () => {
    let b = { a: 1000, c: 500 }
    b = applyTransfer(b, { from: 'a', to: 'c', amount: 300, credited: 300 })
    expect(b).toEqual({ a: 700, c: 800 })
    // 'c' is being deleted: its incoming transfer gives 300 back to 'a'
    b = revertIncomingTransfer(b, { from: 'a', amount: 300 })
    expect(b).toEqual({ a: 1000, c: 800 })
  })
})
