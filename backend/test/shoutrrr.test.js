import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'

// The guard is read once when the plugin module loads
vi.hoisted(() => {
  process.env.SHOUTRRR_BLOCK_PRIVATE_TARGETS = 'true'
})

const { default: shoutrrrPlugin, blockPrivateTargets } = await import('../plugins/shoutrrr.js')

describe('blockPrivateTargets', () => {
  it('blocks by default and only opts out on an explicit false', () => {
    expect(blockPrivateTargets(undefined)).toBe(true)
    expect(blockPrivateTargets('')).toBe(true)
    expect(blockPrivateTargets('true')).toBe(true)
    expect(blockPrivateTargets('false')).toBe(false)
    expect(blockPrivateTargets(' No ')).toBe(false)
    expect(blockPrivateTargets('0')).toBe(false)
  })
})

async function buildApp() {
  const app = Fastify()
  await app.register(shoutrrrPlugin)
  await app.ready()
  return app
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendShoutrrr with SHOUTRRR_BLOCK_PRIVATE_TARGETS on', () => {
  it('refuses a bracketed IPv6 loopback webhook without calling it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildApp()
    await expect(app.sendShoutrrr('http://[::1]/hook', { title: 't', message: 'm' }))
      .rejects.toThrow(/private network/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not follow redirects of an allowed webhook', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }))
    vi.stubGlobal('fetch', fetchMock)
    const app = await buildApp()
    await expect(app.sendShoutrrr('https://8.8.8.8/hook', { title: 't', message: 'm' }))
      .rejects.toThrow(/HTTP 302/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
  })

  it('refuses a shoutrrr service URL on a private host before running the CLI', async () => {
    const app = await buildApp()
    await expect(app.sendShoutrrr('gotify://10.0.0.7/token', { title: 't', message: 'm' }))
      .rejects.toThrow(/private network/)
  })
})
