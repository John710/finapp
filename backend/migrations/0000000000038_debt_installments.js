// Installment schedules for debts: a finite list of dated amounts per debt,
// each due, paid or skipped. The rows are material (no recurrence rule), so a
// date is edited in place and the calendar reads the table directly.
//
// debt_payments.installment_id links a payment to the installment it settled,
// so undoing that installment finds its payment without guessing by note.
// SET NULL keeps the payment (it is money that moved) when a schedule row goes.

export const up = (pgm) => {
  pgm.createTable('debt_installments', {
    id: { type: 'serial', primaryKey: true },
    debt_id: { type: 'integer', notNull: true, references: 'debts', onDelete: 'CASCADE' },
    // the debt's owner, as on debt_payments
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    position: { type: 'integer', notNull: true },
    due_date: { type: 'date', notNull: true },
    amount: { type: 'numeric(24,12)', notNull: true, check: 'amount > 0' },
    status: {
      type: 'varchar(10)',
      notNull: true,
      default: 'due',
      check: "status IN ('due', 'paid', 'skipped')"
    },
    paid_on: { type: 'date' },
    note: { type: 'text' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('debt_installments', 'debt_installments_debt_id_position_key', {
    unique: ['debt_id', 'position']
  })
  // Two installments on one day are an input error; it also keys the rows by date.
  pgm.addConstraint('debt_installments', 'debt_installments_debt_id_due_date_key', {
    unique: ['debt_id', 'due_date']
  })
  // calendar scans: a user's installments over a date range
  pgm.createIndex('debt_installments', ['user_id', 'due_date'], {
    name: 'debt_installments_user_id_due_date_idx'
  })
  pgm.createIndex('debt_installments', ['due_date'], {
    name: 'debt_installments_due_date_due_idx',
    where: "status = 'due'"
  })

  pgm.addColumn('debt_payments', {
    installment_id: { type: 'integer', references: 'debt_installments', onDelete: 'SET NULL' }
  })
}

export const down = (pgm) => {
  // The column references the table, so it goes first.
  pgm.dropColumn('debt_payments', 'installment_id')
  pgm.dropTable('debt_installments')
}
