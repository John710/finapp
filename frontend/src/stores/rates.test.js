// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRatesStore } from './rates.js'

describe('rates store formatConverted', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('converts into the base currency when a rate exists', () => {
    const store = useRatesStore()
    store.setBaseCurrency('RUB')
    store.rates = [{ from_currency: 'USD', to_currency: 'RUB', rate: '90' }]
    const out = store.formatConverted(10, 'USD', false)
    expect(out).toContain('900')
    expect(out).not.toContain('$')
  })

  it('shows the amount in its own currency when there is no rate', () => {
    const store = useRatesStore()
    store.setBaseCurrency('RUB')
    store.rates = []
    const out = store.formatConverted(10, 'EUR')
    // The raw 10 EUR must not be presented as 10 RUB
    expect(out).toContain('€')
    expect(out).not.toContain('₽')
  })

  it('does not throw for a crypto ticker without a rate', () => {
    const store = useRatesStore()
    store.rates = []
    expect(store.formatConverted(1.5, 'DOGE')).toContain('1.5')
  })
})
