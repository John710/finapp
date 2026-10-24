import { describe, it, expect } from 'vitest'
import { parseAmount } from './format.js'

describe('parseAmount', () => {
  it('passes numbers through', () => {
    expect(parseAmount(12.5)).toBe(12.5)
    expect(parseAmount(-3)).toBe(-3)
    expect(parseAmount(0)).toBe(0)
  })

  it('parses dot decimals', () => {
    expect(parseAmount('12.50')).toBe(12.5)
  })

  it('normalizes comma decimals (ru keyboard layout)', () => {
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('0,1')).toBe(0.1)
  })

  it('strips spaces (copy-pasted formatted values)', () => {
    expect(parseAmount('1 250,50')).toBe(1250.5)
  })

  it('returns NaN for empty and invalid input', () => {
    expect(Number.isNaN(parseAmount(''))).toBe(true)
    expect(Number.isNaN(parseAmount(null))).toBe(true)
    expect(Number.isNaN(parseAmount(undefined))).toBe(true)
    expect(Number.isNaN(parseAmount('abc'))).toBe(true)
  })
})
