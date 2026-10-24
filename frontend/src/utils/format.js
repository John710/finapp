import { getUserLocale } from './locale.js'

export function formatCurrency(value, currency) {
  if (value === null || value === undefined) return '-'
  // Intl throws a RangeError on unknown currency codes — degrade to a plain
  // number instead of crashing the component that renders it.
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
    return new Intl.NumberFormat(getUserLocale()).format(value)
  }
  return new Intl.NumberFormat(getUserLocale(), { style: 'currency', currency }).format(value)
}

export function formatDate(date) {
  if (!date) return '-'
  return new Date(date).toLocaleDateString(getUserLocale())
}

export function formatDateTime(value, locale) {
  if (!value) return '-'
  return new Date(value).toLocaleString(locale || getUserLocale())
}

export function formatNotifDate(date) {
  return formatDate(date)
}

// Money inputs: with a ru keyboard layout users type "12,50" — type=number
// rejects the comma in some browser/locale combinations and v-model.number
// then keeps the raw string. Normalize before sending to the API.
export function parseAmount(value) {
  if (typeof value === 'number') return value
  if (value === null || value === undefined || value === '') return NaN
  const normalized = String(value).replace(/\s/g, '').replace(',', '.')
  return parseFloat(normalized)
}
