import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '../utils/api'

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
    return rate !== null ? amount * rate : null
  }

  function format(amount, currency) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(amount || 0)
  }

  function formatConverted(amount, fromCurrency, showOriginal = true) {
    if (amount === null || amount === undefined) return '-'
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    if (Number.isNaN(num)) return '-'

    const converted = convert(num, fromCurrency, baseCurrency.value)
    const baseFormatted = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: baseCurrency.value }).format(converted !== null ? converted : num)

    if (!showOriginal || fromCurrency === baseCurrency.value || converted === null) return baseFormatted

    const origFormatted = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: fromCurrency }).format(num)
    return `${origFormatted} ≈ ${baseFormatted}`
  }

  async function fetchRates() {
    loading.value = true
    try {
      const [ratesRes, fiatRes] = await Promise.all([
        api('/currencies'),
        api('/currencies/fiat')
      ])
      rates.value = ratesRes
      fiatCurrencies.value = fiatRes
    } catch (e) {
      console.error('Failed to load rates', e)
    } finally {
      loading.value = false
    }
  }

  return { rates, fiatCurrencies, loading, baseCurrency, setBaseCurrency, getRate, convert, format, formatConverted, fetchRates }
})
