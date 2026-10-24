import { useI18n } from 'vue-i18n'

// Shared transaction display helpers — previously copy-pasted across
// TransactionsView, DashboardView and AccountDetailView.
export function useTransactionDisplay(accountsStore) {
  const { t } = useI18n()

  // Renders a transaction note: transfers are described by their counterparty
  // account, legacy system notes (debt markers) are translated.
  function formatNote(tx) {
    if (!tx) return ''
    // Outgoing transfer
    if (tx.type === 'transfer' && tx.transfer_to_account_id) {
      const target = accountsStore.accounts.find(a => a.id === tx.transfer_to_account_id)
      return target ? `${t('transactions.types.transfer')} → ${target.name}` : (tx.note || '')
    }
    // Incoming paired transfer (income side) — transfer_to_account_id holds the source account
    if (tx.type === 'income' && tx.transfer_to_account_id) {
      const source = accountsStore.accounts.find(a => a.id === tx.transfer_to_account_id)
      return source ? `${t('transactions.types.transfer')} ← ${source.name}` : (tx.note || '')
    }
    if (!tx.note) return ''
    return tx.note
      .replace(/^Debt created:\s*/, t('debts.tx_created') + ': ')
      .replace(/^debt_created:\s*/, t('debts.tx_created') + ': ')
      .replace(/^Debt payment:\s*/, t('debts.tx_payment') + ': ')
      .replace(/^debt_payment:\s*/, t('debts.tx_payment') + ': ')
  }

  function amountClass(type) {
    if (type === 'income') return 'text-primary-600'
    if (type === 'expense') return 'text-danger-500'
    return 'text-slate-700 dark:text-slate-300'
  }

  function categoryClass(type) {
    if (type === 'income') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    if (type === 'expense') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  }

  return { formatNote, amountClass, categoryClass }
}
