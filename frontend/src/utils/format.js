import { getUserLocale } from './locale.js'

export function formatCurrency(value, currency) {
  if (value === null || value === undefined) return '-'
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
