import { describe, it, expect } from 'vitest'
import { isPrivateAddress, isPrivateTarget } from '../services/network.js'

// dns.lookup stand-in: hostname -> list of addresses; unknown names fail like ENOTFOUND
function lookupFrom(table) {
  return async host => {
    if (!(host in table)) {
      const err = new Error(`getaddrinfo ENOTFOUND ${host}`)
      err.code = 'ENOTFOUND'
      throw err
    }
    return table[host].map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', '[::1]', 'fe80::1', 'fd12:3456::1', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '[::ffff:192.168.0.1]',
    '64:ff9b::7f00:1', '2002:7f00:1::1', 'fe80::1%eth0'
  ])('%s is private', ip => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2002:808:808::1'
  ])('%s is public', ip => {
    expect(isPrivateAddress(ip)).toBe(false)
  })

  it('does not treat a hostname as an address', () => {
    expect(isPrivateAddress('example.com')).toBe(false)
  })
})

describe('isPrivateTarget', () => {
  const lookup = lookupFrom({
    'hooks.example.com': ['93.184.216.34'],
    'internal.example.com': ['10.0.0.5'],
    'split.example.com': ['93.184.216.34', '192.168.1.20'],
    'v6only.example.com': ['::ffff:127.0.0.1'],
    'gotify.example.com': ['203.0.113.7']
  })

  it('catches bracketed IPv6 literals (URL keeps the brackets in hostname)', async () => {
    expect(new URL('http://[::1]/').hostname).toBe('[::1]')
    expect(await isPrivateTarget('http://[::1]/hook', { lookup })).toBe(true)
    expect(await isPrivateTarget('https://[::ffff:127.0.0.1]/hook', { lookup })).toBe(true)
  })

  it('resolves hostnames and refuses when any address is private', async () => {
    expect(await isPrivateTarget('https://hooks.example.com/x', { lookup })).toBe(false)
    expect(await isPrivateTarget('https://internal.example.com/x', { lookup })).toBe(true)
    expect(await isPrivateTarget('https://split.example.com/x', { lookup })).toBe(true)
    expect(await isPrivateTarget('https://v6only.example.com/x', { lookup })).toBe(true)
  })

  it('catches localhost names without a lookup', async () => {
    expect(await isPrivateTarget('http://localhost:8080/x', { lookup })).toBe(true)
    expect(await isPrivateTarget('http://app.localhost/x', { lookup })).toBe(true)
    expect(await isPrivateTarget('http://nas.local/x', { lookup })).toBe(true)
  })

  it('checks the host of non-http shoutrrr URLs too', async () => {
    expect(await isPrivateTarget('gotify://192.168.1.10/AbCdEf', { lookup })).toBe(true)
    expect(await isPrivateTarget('gotify://[fd00::5]:8080/AbCdEf', { lookup })).toBe(true)
    expect(await isPrivateTarget('gotify://internal.example.com/AbCdEf', { lookup })).toBe(true)
    expect(await isPrivateTarget('generic+https://localhost/hook', { lookup })).toBe(true)
    expect(await isPrivateTarget('smtp://user:pass@127.0.0.1:25/?from=a@b.c&to=d@e.f', { lookup })).toBe(true)
    expect(await isPrivateTarget('gotify://gotify.example.com/AbCdEf', { lookup })).toBe(false)
  })

  it('decodes percent-escaped hosts the shoutrrr CLI would decode', async () => {
    expect(await isPrivateTarget('gotify://%31%32%37.0.0.1/token', { lookup })).toBe(true)
  })

  it('allows service URLs whose host is a service name, not a network host', async () => {
    expect(await isPrivateTarget('telegram://123456:ABC-def@telegram?chats=@channel', { lookup })).toBe(false)
    expect(await isPrivateTarget('discord://token@1234567890', { lookup })).toBe(false)
  })

  it('refuses what it cannot parse', async () => {
    expect(await isPrivateTarget('http://exa mple.com/', { lookup })).toBe(true)
  })
})
