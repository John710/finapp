// debts.auto_paid tells a 'paid' status the payments set (recordDebtPayment)
// from one the owner set by hand (PUT /debts/:id). Undoing an installment
// payment reopens only the former: a debt the owner closed stays closed.
//
// Existing paid debts that have payments keep the behaviour they had before
// the column existed — undo reopens them when the payments no longer cover the
// amount. Paid debts without any payment can only have been closed by hand.

export const up = (pgm) => {
  pgm.addColumn('debts', {
    auto_paid: { type: 'boolean', notNull: true, default: false }
  })
  pgm.sql(`UPDATE debts d SET auto_paid = true
    WHERE d.status = 'paid' AND EXISTS (SELECT 1 FROM debt_payments p WHERE p.debt_id = d.id)`)
}

export const down = (pgm) => {
  pgm.dropColumn('debts', 'auto_paid')
}
