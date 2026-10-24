import { describe, it, expect } from 'vitest'
import { formatConverted, formatFull } from './currency.js'

const rates = [
  { from_currency: 'USD', to_currency: 'RUB', rate: '92.5' },
  { from_currency: 'EUR', to_currency: 'USD', rate: '1.08' }
]

describe('formatConverted', () => {
  it('formats the raw amount when currencies match', () => {
    expect(formatConverted(12.5, 'USD', 'USD', rates)).toContain('12.5')
  })

  it('marks converted amounts with the approximation sign', () => {
    const out = formatConverted('100', 'USD', 'RUB', rates)
    expect(out.startsWith('≈')).toBe(true)
    expect(out.includes('RUB')).toBe(true)
  })

  it('falls back to the raw amount without rates', () => {
    const out = formatConverted(100, 'USD', 'RUB', [])
    expect(out).not.toContain('≈')
  })

  it('handles dash for null/undefined', () => {
    expect(formatConverted(null, 'USD', 'USD', rates)).toBe('-')
    expect(formatConverted(undefined, 'USD', 'USD', rates)).toBe('-')
  })
})

describe('formatFull', () => {
  it('returns only the raw value when currencies match', () => {
    const out = formatFull('10', 'USD', 'USD', rates)
    expect(out.includes('≈')).toBe(false)
  })

  it('appends the conversion for other currencies', () => {
    const out = formatFull('10', 'USD', 'RUB', rates)
    expect(out.includes('≈')).toBe(true)
  })
})
