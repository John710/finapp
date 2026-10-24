import { describe, it, expect } from 'vitest'
import { convertAmount, convertAmountDecimal } from '../services/currency.js'

const rates = [
  { from_currency: 'USD', to_currency: 'RUB', rate: '92.5' },
  { from_currency: 'EUR', to_currency: 'USD', rate: '1.08' },
  { from_currency: 'BTC', to_currency: 'USD', rate: '65000.123456789012' }
]

describe('convertAmountDecimal', () => {
  it('converts with a direct rate', () => {
    expect(convertAmountDecimal('100', 'USD', 'RUB', rates).toString()).toBe('9250')
  })

  it('passes the same currency through unchanged', () => {
    expect(convertAmountDecimal('1500.000000000000', 'USD', 'USD', rates).toString()).toBe('1500')
  })

  it('converts via USD (from->USD, USD->to)', () => {
    expect(convertAmountDecimal('10', 'EUR', 'RUB', rates).toString()).toBe('999')
  })

  it('inverts a to-USD rate for crypto targets', () => {
    // 2 * 65000.123456789012 * 92.5 — exact decimal arithmetic
    expect(convertAmountDecimal('2', 'BTC', 'RUB', rates).toString()).toBe('12025022.83950596722')
  })

  it('inverts via USD (RUB -> USD -> EUR)', () => {
    const result = convertAmountDecimal('9250', 'RUB', 'EUR', rates).toString()
    expect(result.startsWith('92.59259259')).toBe(true)
  })

  it('returns null when no path exists', () => {
    expect(convertAmountDecimal('1', 'USD', 'JPY', rates)).toBe(null)
  })

  it('returns null with no rates', () => {
    expect(convertAmountDecimal('1', 'USD', 'EUR', [])).toBe(null)
  })

  it('avoids binary float drift on 0.1-style values', () => {
    expect(convertAmountDecimal('0.1', 'USD', 'RUB', rates).times('3').toString()).toBe('27.75')
  })
})

describe('convertAmount (number wrapper)', () => {
  it('returns numbers for route/SQL callers', () => {
    expect(convertAmount('100', 'USD', 'RUB', rates)).toBe(9250)
    expect(convertAmount('1', 'USD', 'JPY', rates)).toBe(null)
  })
})
