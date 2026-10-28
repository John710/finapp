// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from './api.js'

function setLocation(pathname, search = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname, search, href: `${pathname}${search}` }
  })
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('api()', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a Blob for responseType blob', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('a,b\n1,2', { status: 200 })))
    const out = await api('/export/csv', { responseType: 'blob' })
    expect(out).toBeInstanceOf(Blob)
    expect(await out.text()).toBe('a,b\n1,2')
  })

  it('does not pass responseType on to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'))
    vi.stubGlobal('fetch', fetchMock)
    await api('/export/csv', { responseType: 'blob' })
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('responseType')
  })

  it('keeps the current page in ?redirect= when the session is dead', async () => {
    setLocation('/budgets', '?x=1')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api('/budgets')).rejects.toThrow()
    expect(window.location.href).toBe(`/login?redirect=${encodeURIComponent('/budgets?x=1')}`)
  })

  it('does not add ?redirect= from the login page itself', async () => {
    setLocation('/login')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)))
    await expect(api('/budgets')).rejects.toThrow()
    expect(window.location.href).toBe('/login')
  })

  it('uses a localized message for a bare HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    await expect(api('/accounts')).rejects.toThrow(/500/)
  })
})
