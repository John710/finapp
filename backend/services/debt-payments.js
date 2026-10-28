import Decimal from 'decimal.js'
import { convertAmountDecimal } from './currency.js'

/**
 * Sum of a debt's payments in the debt's own currency, as an exact Decimal.
 * A payment without a usable rate counts at its raw amount (onMissingRate is
 * told about it) so a missing rate never makes a debt look unpaid.
 */
export function paidInDebtCurrency(payments, debtCurrency, rates, onMissingRate) {
  let paid = new Decimal(0)
  for (const p of payments) {
    const paymentCurrency = p.currency || debtCurrency
    const converted = convertAmountDecimal(p.amount, paymentCurrency, debtCurrency, rates)
    if (converted === null) {
      if (onMissingRate) onMissingRate(p, paymentCurrency)
      paid = paid.plus(new Decimal(p.amount))
    } else {
      paid = paid.plus(converted)
    }
  }
  return paid
}

// What is still owed on a debt; never negative (overpayment means settled).
export function remainingOnDebt(amount, paid) {
  const remaining = new Decimal(amount).minus(paid)
  return remaining.isNegative() ? new Decimal(0) : remaining
}
