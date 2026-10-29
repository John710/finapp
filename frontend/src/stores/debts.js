import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useDebtsStore = defineStore('debts', () => {
  const debts = ref([])
  const loading = ref(false)

  // `silent` re-reads without swapping the list for skeletons (after a write).
  async function fetchDebts(silent = false) {
    if (!silent) loading.value = true
    try {
      debts.value = await api('/debts')
    } finally {
      loading.value = false
    }
  }

  async function createDebt(data) {
    const debt = await api('/debts', { method: 'POST', body: JSON.stringify(data) })
    debts.value.unshift(debt)
    return debt
  }

  async function updateDebt(id, data) {
    const debt = await api(`/debts/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    // The PUT answer is the bare row: no paid_amount, remaining or installments.
    await fetchDebts(true)
    return debt
  }

  async function addPayment(id, data) {
    const payment = await api(`/debts/${id}/payments`, { method: 'POST', body: JSON.stringify(data) })
    await fetchDebts(true)
    return payment
  }

  async function getPayments(id) {
    return await api(`/debts/${id}/payments`)
  }

  // The server reverses the money the debt moved and answers
  // { success, reversed_transactions, kept_transactions } (kept = edited by hand).
  async function deleteDebt(id) {
    const result = await api(`/debts/${id}`, { method: 'DELETE' })
    debts.value = debts.value.filter(d => d.id !== id)
    return {
      reversed: result?.reversed_transactions ?? [],
      kept: result?.kept_transactions ?? []
    }
  }

  // Installment writes change the schedule and the debt's payments / balances,
  // and the calendar reads them too: re-read the debts afterwards, like addPayment.
  // `rows` is [{ due_date, amount }]; an empty list removes the schedule.
  async function saveInstallments(debtId, rows) {
    const result = await api(`/debts/${debtId}/installments`, { method: 'PUT', body: JSON.stringify({ rows }) })
    await fetchDebts(true)
    return result
  }

  // `data` is { account_id?, currency? }: omitted account = the debt's account,
  // null = no transaction.
  async function payInstallment(id, data = {}) {
    const result = await api(`/debts/installments/${id}/pay`, { method: 'POST', body: JSON.stringify(data) })
    await fetchDebts(true)
    return result
  }

  async function unpayInstallment(id) {
    const result = await api(`/debts/installments/${id}/pay`, { method: 'DELETE' })
    await fetchDebts(true)
    return result
  }

  async function skipInstallment(id) {
    const result = await api(`/debts/installments/${id}/skip`, { method: 'POST', body: JSON.stringify({}) })
    await fetchDebts(true)
    return result
  }

  async function unskipInstallment(id) {
    const result = await api(`/debts/installments/${id}/skip`, { method: 'DELETE' })
    await fetchDebts(true)
    return result
  }

  async function updateInstallment(id, patch) {
    const result = await api(`/debts/installments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    await fetchDebts(true)
    return result
  }

  return {
    debts, loading, fetchDebts, createDebt, updateDebt, addPayment, getPayments, deleteDebt,
    saveInstallments, payInstallment, unpayInstallment, skipInstallment, unskipInstallment, updateInstallment
  }
})
