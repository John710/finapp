import { describe, it, expect } from 'vitest'
import { amountText } from '../plugins/cron.js'

describe('amountText (reminder amounts)', () => {
  it('drops the numeric(24,12) padding without a float detour', () => {
    expect(amountText('15.990000000000')).toBe('15.99')
    expect(amountText('1500.000000000000')).toBe('1500')
  })

  it('prints tiny crypto amounts in plain notation', () => {
    // String(Number('0.000000010000')) is '1e-8'
    expect(amountText('0.000000010000')).toBe('0.00000001')
  })

  it('keeps every significant digit of a large amount', () => {
    // Number() keeps ~17 digits: 123456789012.12346
    expect(amountText('123456789012.123456789012')).toBe('123456789012.123456789012')
  })

  it('passes a non-numeric value through as text', () => {
    expect(amountText('n/a')).toBe('n/a')
  })
})
