// Request body for POST/PUT /debts. The API rejects an empty due_date (it must
// be a date or absent) and an edit must not send view-only fields back.
export function debtPayload(form) {
  const payload = {
    name: form.name,
    counterparty: form.counterparty,
    amount: form.amount,
    currency: form.currency,
    type: form.type,
    description: form.description || '',
    account_id: form.account_id ?? null
  }
  if (form.due_date) payload.due_date = String(form.due_date).slice(0, 10)
  return payload
}
