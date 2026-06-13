/**
 * Currency conversion helpers.
 * All monetary calculations use parseFloat on PostgreSQL numeric strings
 * and rely on numeric(24,12) columns for precision.
 */

export async function loadRates(db) {
  const result = await db.query(`
    SELECT DISTINCT ON (from_currency, to_currency)
      from_currency, to_currency, rate
    FROM exchange_rates
    ORDER BY from_currency, to_currency, updated_at DESC
  `)
  return result.rows
}

export function convertAmount(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return amount
  if (!rates || rates.length === 0) return null

  // Direct rate
  const direct = rates.find(r => r.from_currency === fromCurrency && r.to_currency === toCurrency)
  if (direct) {
    return amount * parseFloat(direct.rate)
  }

  // Via USD
  const fromToUsd = rates.find(r => r.from_currency === fromCurrency && r.to_currency === 'USD')

  let usdToTargetRate = null
  if (toCurrency === 'USD') {
    usdToTargetRate = 1
  } else {
    const usdToTarget = rates.find(r => r.from_currency === 'USD' && r.to_currency === toCurrency)
    if (usdToTarget) {
      usdToTargetRate = parseFloat(usdToTarget.rate)
    } else {
      // Check if we have target->USD, then inverse it (for crypto)
      const targetToUsd = rates.find(r => r.from_currency === toCurrency && r.to_currency === 'USD')
      if (targetToUsd) {
        usdToTargetRate = 1 / parseFloat(targetToUsd.rate)
      }
    }
  }

  if (fromToUsd && usdToTargetRate !== null) {
    return amount * parseFloat(fromToUsd.rate) * usdToTargetRate
  }

  // Inverse via USD (e.g. RUB -> USD -> EUR)
  let usdToFromRate = null
  const usdToFrom = rates.find(r => r.from_currency === 'USD' && r.to_currency === fromCurrency)
  if (usdToFrom) {
    usdToFromRate = parseFloat(usdToFrom.rate)
  } else {
    // Check if we have from->USD, then inverse it (for crypto)
    const fromToUsdInverse = rates.find(r => r.from_currency === fromCurrency && r.to_currency === 'USD')
    if (fromToUsdInverse) {
      usdToFromRate = 1 / parseFloat(fromToUsdInverse.rate)
    }
  }

  if (usdToFromRate !== null && usdToTargetRate !== null) {
    return (amount / usdToFromRate) * usdToTargetRate
  }

  return null
}
