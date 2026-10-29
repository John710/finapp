import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { formatDate, parseAmount } from './format.js'

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

  it('takes the last of comma/dot as the decimal separator', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('1,234,567.89')).toBe(1234567.89)
    expect(parseAmount('1.234.567,89')).toBe(1234567.89)
  })

  it('reads a repeated lone separator as grouping', () => {
    expect(parseAmount('1,234,567')).toBe(1234567)
    expect(parseAmount('1.234.567')).toBe(1234567)
  })

  it('strips NBSP, narrow NBSP and apostrophe grouping', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56)
    expect(parseAmount('1 234,56')).toBe(1234.56)
    expect(parseAmount("1'234.56")).toBe(1234.56)
  })

  it('keeps the sign', () => {
    expect(parseAmount('-1,234.56')).toBe(-1234.56)
    expect(parseAmount('−12,5')).toBe(-12.5)
    expect(parseAmount('+3')).toBe(3)
  })

  it('reads API amounts, including exponent notation from decimal.js', () => {
    expect(parseAmount('150.000000000000')).toBe(150)
    expect(parseAmount('-0.000000120000')).toBe(-0.00000012)
    expect(parseAmount('1e-8')).toBe(1e-8)
  })

  it('returns NaN for empty and invalid input', () => {
    expect(Number.isNaN(parseAmount(''))).toBe(true)
    expect(Number.isNaN(parseAmount('   '))).toBe(true)
    expect(Number.isNaN(parseAmount(null))).toBe(true)
    expect(Number.isNaN(parseAmount(undefined))).toBe(true)
    expect(Number.isNaN(parseAmount('abc'))).toBe(true)
    expect(Number.isNaN(parseAmount('12abc'))).toBe(true)
    expect(Number.isNaN(parseAmount('1,2,3.4.5'))).toBe(true)
    expect(Number.isNaN(parseAmount('12,34.5,6'))).toBe(true)
  })
})

describe('formatDate', () => {
  // Negative UTC offset: `new Date('2026-10-29')` is Oct 28, 20:00 here, so a
  // calendar day parsed as an instant would render one day early.
  // Node changes the process timezone as soon as TZ is assigned
  const env = globalThis.process.env
  const originalTz = env.TZ
  beforeAll(() => {
    env.TZ = 'America/New_York'
    localStorage.setItem('lang', 'en')
  })
  afterAll(() => {
    if (originalTz === undefined) delete env.TZ
    else env.TZ = originalTz
    localStorage.removeItem('lang')
  })

  it('runs in a timezone west of UTC', () => {
    expect(new Date('2026-10-29').getDate()).toBe(28)
  })

  it('renders a YYYY-MM-DD string as that calendar day', () => {
    expect(formatDate('2026-10-29')).toBe('10/29/2026')
    expect(formatDate('2026-01-01')).toBe('1/1/2026')
  })

  it('keeps ISO timestamps on the instant they describe', () => {
    // 03:00 UTC on Oct 29 is still Oct 28 in New York
    expect(formatDate('2026-10-29T03:00:00.000Z')).toBe('10/28/2026')
  })

  it('shows a dash for empty values', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate('')).toBe('-')
  })
})
