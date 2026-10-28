import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { encrypt, decrypt } from '../services/crypto.js'

beforeAll(() => {
  vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32))
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('crypto', () => {
  it('round-trips a value', () => {
    expect(decrypt(encrypt('secret value'))).toBe('secret value')
  })

  it('refuses a truncated GCM auth tag', () => {
    const [iv, tag, data] = encrypt('secret value').split(':')
    // A 4-byte tag would be accepted by GCM unless the tag length is pinned
    expect(decrypt(`${iv}:${tag.slice(0, 8)}:${data}`)).toBeNull()
  })
})
