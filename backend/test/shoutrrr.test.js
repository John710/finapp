import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'

// The guard is read once when the plugin module loads
vi.hoisted(() => {
  process.env.SHOUTRRR_BLOCK_PRIVATE_TARGETS = 'true'
})

const execMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execMock }))

const { default: shoutrrrPlugin, blockPrivateTargets, maskUrl } = await import('../plugins/shoutrrr.js')

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

describe('maskUrl', () => {
  it('keeps only scheme and host[:port]', () => {
    expect(maskUrl('gotify://host.example:8080/messages/SECRET?priority=1')).toBe('gotify://host.example:8080')
    expect(maskUrl('telegram://123:SECRET@telegram?chats=@x')).toBe('telegram://telegram')
    expect(maskUrl('discord://SECRET@1234/WEBHOOK')).toBe('discord://1234')
    expect(maskUrl('https://user:pw@hooks.example/a/SECRET?k=v')).toBe('https://hooks.example')
    expect(maskUrl('not a url')).toBe('invalid-url')
  })
})

describe('shoutrrr CLI failure', () => {
  it('neither logs nor returns the token', async () => {
    const SECRET = 'SUPERSECRETTOKEN123'
    const url = `discord://${SECRET}@8.8.8.8/WEBHOOKID?color=${SECRET}`
    execMock.mockImplementation((cmd, args, opts, cb) => {
      const e = new Error(`Command failed: shoutrrr send --url ${url}`)
      e.stderr = `invalid token "${url}" / ${SECRET} / WEBHOOKID`
      cb(e)
    })
    const logs = []
    const app = await buildApp()
    app.log.warn = (...a) => logs.push(JSON.stringify(a))
    const err = await app.sendShoutrrr(url, { title: 'T', message: 'M' }).catch(e => e)
    expect(err.message).toBe('Shoutrrr (discord://8.8.8.8) failed')
    expect(logs.length).toBe(1)
    expect(logs[0]).not.toContain(SECRET)
    expect(logs[0]).not.toContain('WEBHOOKID')
    expect(logs[0]).toContain('***')
  })
})
