/**
 * Currency conversion helpers.
 * All conversions run through decimal.js: intermediate float chains like
 * amount * rate * usdToTarget accumulate rounding error on numeric(24,12)
 * values. convertAmount() returns a plain number for route/SQL callers;
 * convertAmountDecimal() returns the exact Decimal for aggregation code.
 */
import Decimal from 'decimal.js'

export async function loadRates(db) {
  const result = await db.query(`
    SELECT DISTINCT ON (from_currency, to_currency)
      from_currency, to_currency, rate
    FROM exchange_rates
    ORDER BY from_currency, to_currency, updated_at DESC
  `)
  return result.rows
}

export function convertAmountDecimal(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return new Decimal(amount)
  if (!rates || rates.length === 0) return null

  const value = new Decimal(amount)
  const rateOf = (from, to) => {
    const r = rates.find(r => r.from_currency === from && r.to_currency === to)
    return r ? new Decimal(r.rate) : null
  }

  // Direct rate
  const direct = rateOf(fromCurrency, toCurrency)
  if (direct) {
    return value.times(direct)
  }

  // Via USD
  const fromToUsd = rateOf(fromCurrency, 'USD')

  let usdToTarget = null
  if (toCurrency === 'USD') {
    usdToTarget = new Decimal(1)
  } else {
    usdToTarget = rateOf('USD', toCurrency)
    if (!usdToTarget) {
      // Check if we have target->USD, then inverse it (for crypto)
      const targetToUsd = rateOf(toCurrency, 'USD')
      if (targetToUsd) {
        usdToTarget = new Decimal(1).div(targetToUsd)
      }
    }
  }

  if (fromToUsd && usdToTarget) {
    return value.times(fromToUsd).times(usdToTarget)
  }

  // Inverse via USD (e.g. RUB -> USD -> EUR)
  let usdToFrom = rateOf('USD', fromCurrency)
  if (!usdToFrom && fromToUsd) {
    usdToFrom = new Decimal(1).div(fromToUsd)
  }

  if (usdToFrom && usdToTarget) {
    return value.div(usdToFrom).times(usdToTarget)
  }

  return null
}

export function convertAmount(amount, fromCurrency, toCurrency, rates) {
  const converted = convertAmountDecimal(amount, fromCurrency, toCurrency, rates)
  return converted === null ? null : converted.toNumber()
}
