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

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

// A 'YYYY-MM-DD' value is a calendar day, not an instant: `new Date('2026-10-29')`
// is UTC midnight and shows as Oct 28 in any browser west of UTC. Build it
// from its parts at local midnight instead. Timestamps keep the Date parser.
export function formatDate(date) {
  if (!date) return '-'
  const day = typeof date === 'string' ? DATE_ONLY.exec(date) : null
  const value = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(date)
  return value.toLocaleDateString(getUserLocale())
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
// Same rule as the backend CSV import (backend/routes/import.js): spaces, NBSP
// and apostrophes group digits; the last of ',' / '.' is the decimal separator,
// unless it is the only separator kind and repeats ("1,234,567"); grouping
// must come in threes. Anything else is NaN rather than a silently cut number.
export function parseAmount(value) {
  if (typeof value === 'number') return value
  if (value === null || value === undefined) return NaN
  // \s covers NBSP and the narrow NBSP banks and Intl use for grouping
  let str = String(value).trim().replace(/[\s']/g, '').replace(/−/g, '-')
  // API amounts computed with decimal.js print tiny values as "1e-8"
  if (/^[+-]?(\d+\.?\d*|\.\d+)e[+-]?\d+$/i.test(str)) return Number(str)
  let sign = ''
  if (str.startsWith('-') || str.startsWith('+')) {
    sign = str[0] === '-' ? '-' : ''
    str = str.slice(1)
  }
  if (!/^[\d.,]+$/.test(str) || !/\d/.test(str)) return NaN

  const lastDot = str.lastIndexOf('.')
  const lastComma = str.lastIndexOf(',')
  const decimalAt = Math.max(lastDot, lastComma)
  let intPart = str
  let fracPart = ''
  if (decimalAt >= 0) {
    const decimalChar = str[decimalAt]
    const repeated = str.split(decimalChar).length - 1 > 1
    if (!(repeated && (lastDot < 0 || lastComma < 0))) {
      intPart = str.slice(0, decimalAt)
      fracPart = str.slice(decimalAt + 1)
      if (!/^\d*$/.test(fracPart)) return NaN
    }
  }
  if (/[.,]/.test(intPart)) {
    const grouping = intPart.match(/[.,]/)[0]
    if (intPart.includes(grouping === '.' ? ',' : '.')) return NaN
    const groups = intPart.split(grouping)
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(g => !/^\d{3}$/.test(g))) return NaN
    intPart = groups.join('')
  }
  return Number(`${sign}${intPart || '0'}.${fracPart || '0'}`)
}
