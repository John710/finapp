/**
 * Currency formatting helpers.
 * All conversion math is done with parseFloat (backend stores numeric(24,12)).
 */

export function formatRaw(amount, currency = '') {
  if (amount === null || amount === undefined) return '-'
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(num)) return '-'
  return num.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  }) + (currency ? ` ${currency}` : '')
}

export function formatConverted(amount, accountCurrency, baseCurrency, rates) {
  if (amount === null || amount === undefined) return '-'
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(num)) return '-'

  if (!rates || !rates.length || accountCurrency === baseCurrency) {
    return formatRaw(num, accountCurrency)
  }

  // Direct
  const direct = rates.find(r => r.from_currency === accountCurrency && r.to_currency === baseCurrency)
  if (direct) {
    const converted = num * parseFloat(direct.rate)
    return `≈ ${converted.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency}`
  }

  // Via USD
  const fromToUsd = rates.find(r => r.from_currency === accountCurrency && r.to_currency === 'USD')
  const usdToTarget = baseCurrency === 'USD'
    ? { rate: 1 }
    : rates.find(r => r.from_currency === 'USD' && r.to_currency === baseCurrency)
  if (fromToUsd && usdToTarget) {
    const converted = num * parseFloat(fromToUsd.rate) * parseFloat(usdToTarget.rate)
    return `≈ ${converted.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency}`
  }

  // Inverse via USD
  const usdToFrom = rates.find(r => r.from_currency === 'USD' && r.to_currency === accountCurrency)
  if (usdToFrom && usdToTarget) {
    const converted = (num / parseFloat(usdToFrom.rate)) * parseFloat(usdToTarget.rate)
    return `≈ ${converted.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency}`
  }

  return formatRaw(num, accountCurrency)
}

export function formatFull(amount, accountCurrency, baseCurrency, rates) {
  if (amount === null || amount === undefined) return '-'
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(num)) return '-'

  const raw = formatRaw(num, accountCurrency)
  if (accountCurrency === baseCurrency) return raw

  const converted = formatConverted(amount, accountCurrency, baseCurrency, rates)
  if (converted === raw) return raw
  return `${raw} ${converted}`
}
