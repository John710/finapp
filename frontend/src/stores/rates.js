import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '../utils/api'
import { getUserLocale } from '../utils/locale'
import { logger } from '../utils/logger.js'
import { formatCurrency } from '../utils/format.js'

export const useRatesStore = defineStore('rates', () => {
  const rates = ref([])
  const fiatCurrencies = ref([])
  const loading = ref(false)

  const baseCurrency = ref(localStorage.getItem('base_currency') || 'USD')

  function setBaseCurrency(value) {
    localStorage.setItem('base_currency', value)
    baseCurrency.value = value
  }

  function getRate(from, to) {
    if (from === to) return 1
    if (!rates.value.length) return null

    // Direct
    const direct = rates.value.find(r => r.from_currency === from && r.to_currency === to)
    if (direct) return parseFloat(direct.rate)

    // Via USD
    const fromToUsd = rates.value.find(r => r.from_currency === from && r.to_currency === 'USD')
    const usdToTarget = to === 'USD'
      ? { rate: 1 }
      : rates.value.find(r => r.from_currency === 'USD' && r.to_currency === to)
    if (fromToUsd && usdToTarget) {
      return parseFloat(fromToUsd.rate) * parseFloat(usdToTarget.rate)
    }

    // Inverse via USD
    const usdToFrom = rates.value.find(r => r.from_currency === 'USD' && r.to_currency === from)
    if (usdToFrom && usdToTarget) {
      return (1 / parseFloat(usdToFrom.rate)) * parseFloat(usdToTarget.rate)
    }

    return null
  }

  function convert(amount, from, to) {
    if (from === to) return amount
    const rate = getRate(from, to)
    if (rate === null) return null
    // Round to 6 decimals: enough precision for crypto amounts, while stopping
    // binary-float noise (0.1 + 0.2 style) from accumulating in aggregates.
    return Math.round(amount * rate * 1e6) / 1e6
  }

  function format(amount, currency) {
    return new Intl.NumberFormat(getUserLocale(), { style: 'currency', currency }).format(amount || 0)
  }

  function formatConverted(amount, fromCurrency, showOriginal = true) {
    if (amount === null || amount === undefined) return '-'
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    if (Number.isNaN(num)) return '-'

    const converted = convert(num, fromCurrency, baseCurrency.value)
    // No rate: show the amount in its own currency. Formatting the raw number
    // with the base-currency symbol would present a wrong figure as correct.
    if (converted === null) return formatCurrency(num, fromCurrency)

    const baseFormatted = formatCurrency(converted, baseCurrency.value)
    if (!showOriginal || fromCurrency === baseCurrency.value) return baseFormatted

    return `${formatCurrency(num, fromCurrency)} ≈ ${baseFormatted}`
  }

  // Rates change at most daily — a short TTL avoids refetching /currencies on
  // every page navigation (the store is reloaded on each view mount).
  const RATES_TTL = 60 * 1000
  let lastFetchedAt = 0

  async function fetchRates(force = false) {
    if (!force && rates.value.length && Date.now() - lastFetchedAt < RATES_TTL) return
    loading.value = true
    try {
      const [ratesRes, fiatRes] = await Promise.all([
        api('/currencies'),
        api('/currencies/fiat')
      ])
      rates.value = ratesRes
      fiatCurrencies.value = fiatRes
      lastFetchedAt = Date.now()
    } catch (e) {
      logger.error('Failed to load rates', e)
    } finally {
      loading.value = false
    }
  }

  return { rates, fiatCurrencies, loading, baseCurrency, setBaseCurrency, getRate, convert, format, formatConverted, fetchRates }
})
