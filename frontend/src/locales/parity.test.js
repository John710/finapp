import { describe, it, expect } from 'vitest'
import en from './en.json'
import ru from './ru.json'

function leafKeys(node, prefix = []) {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' ? leafKeys(value, [...prefix, key]) : [...prefix, key].join('.')
  )
}

// Project rule: every user-facing string exists in BOTH catalogs. Interpolation
// placeholders have to match too — a missing {count} renders as a literal brace.
describe('locale catalogs', () => {
  it('expose the same set of keys in en and ru', () => {
    const enKeys = new Set(leafKeys(en))
    const ruKeys = new Set(leafKeys(ru))
    expect([...enKeys].filter(key => !ruKeys.has(key))).toEqual([])
    expect([...ruKeys].filter(key => !enKeys.has(key))).toEqual([])
  })

  it('use the same placeholders for every shared key', () => {
    const read = (catalog, path) => path.split('.').reduce((node, part) => node?.[part], catalog)
    const params = value => [...String(value).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    const mismatches = leafKeys(en)
      .filter(key => typeof read(ru, key) === 'string')
      .map(key => [key, params(read(en, key)).join(','), params(read(ru, key)).join(',')])
      .filter(([, enParams, ruParams]) => enParams !== ruParams)
    expect(mismatches).toEqual([])
  })
})
