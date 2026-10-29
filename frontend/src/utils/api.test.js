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

  it('keeps the server message and flags of a locked second factor (423)', async () => {
    const body = { error: 'Too many wrong codes', totp_required: true, totp_locked: true }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, 423)))
    const err = await api('/auth/login', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.message).toBe('Too many wrong codes')
    expect(err.totp_locked).toBe(true)
    expect(err.totp_required).toBe(true)
  })

  it('keeps the route own message on 429 but replaces the framework one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Rates were refreshed recently' }, 429)))
    await expect(api('/currencies/update', { method: 'POST' })).rejects.toThrow('Rates were refreshed recently')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded' }, 429)))
    const err = await api('/auth/login', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.message).not.toBe('Too Many Requests')
    expect(err.message).not.toBe('Rate limit exceeded')
  })

  it('uses a localized message for a bare HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    await expect(api('/accounts')).rejects.toThrow(/500/)
  })
})
