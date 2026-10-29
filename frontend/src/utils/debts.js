// Undo of a debt deletion recreates it with POST, which books a fresh creation
// transaction and cannot bring payments back. That is only the same debt when
// nothing but the plain debt was deleted: no payments or schedule progress
// (`hadProgress`), no transaction the server left in place (`kept`), no payment
// it could not match to a transaction (`unmatched`).
export function canUndoDebtDelete({ hadProgress, kept = [], unmatched = [] }) {
  return !hadProgress && kept.length === 0 && unmatched.length === 0
}

// Whether a debt row has payments or a schedule that moved on (paid / skipped).
export function debtHadProgress(debt) {
  return Number(debt?.paid_amount) > 0 || !!debt?.installments?.some(item => item.status !== 'due')
}

// Request body for POST/PUT /debts. The API rejects an empty due_date (it must
// be a date or absent) and an edit must not send view-only fields back. The
// editor keeps the amount as a decimal string; the API takes a JSON number.
export function debtPayload(form) {
  const payload = {
    name: form.name,
    counterparty: form.counterparty,
    amount: typeof form.amount === 'string' ? Number(form.amount.trim().replace(',', '.')) : form.amount,
    currency: form.currency,
    type: form.type,
    description: form.description || '',
    account_id: form.account_id ?? null
  }
  if (form.due_date) payload.due_date = String(form.due_date).slice(0, 10)
  return payload
}
