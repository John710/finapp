import { isIP, BlockList } from 'node:net'
import dns from 'node:dns/promises'

// Expands any IPv6 literal to its 8 numeric groups. The WHATWG URL parser does
// the normalisation (embedded dotted IPv4, case, zero compression), so only the
// '::' gap has to be filled in here. Returns null for anything that is not IPv6.
function ipv6Groups(ip) {
  const literal = String(ip || '').replace(/^\[|\]$/g, '').split('%')[0]
  if (isIP(literal) !== 6) return null
  let host
  try {
    host = new URL(`http://[${literal}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const [head, tail] = host.includes('::') ? host.split('::') : [host, null]
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const groups = tail === null
    ? headGroups
    : [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
  return groups.map(g => parseInt(g, 16))
}

function v4FromGroups(hi, lo) {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.')
}

// IPv6 addresses that carry an IPv4 address the packet really goes to:
// IPv4-mapped (::ffff:a.b.c.d), NAT64 well-known prefix (64:ff9b::/96) and 6to4
// (2002:AABB:CCDD::/48). Returns the IPv4 address or null.
function embeddedIPv4(groups) {
  const zeros = n => groups.slice(0, n).every(g => g === 0)
  if (zeros(5) && groups[5] === 0xffff) return v4FromGroups(groups[6], groups[7])
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(g => g === 0)) {
    return v4FromGroups(groups[6], groups[7])
  }
  if (groups[0] === 0x2002) return v4FromGroups(groups[1], groups[2])
  return null
}

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata endpoints
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved + broadcast
]) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['100::', 64], // discard
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8] // multicast
]) blocked.addSubnet(net, prefix, 'ipv6')

// True when the IP literal points at loopback, a private/link-local network or
// another address that is not on the public internet. Accepts bracketed IPv6.
export function isPrivateAddress(ip) {
  const value = String(ip || '').replace(/^\[|\]$/g, '')
  const family = isIP(value)
  if (family === 4) return blocked.check(value, 'ipv4')
  if (family !== 6) return false
  const groups = ipv6Groups(value)
  if (!groups) return true
  const v4 = embeddedIPv4(groups)
  if (v4) return blocked.check(v4, 'ipv4')
  return blocked.check(value.split('%')[0], 'ipv6')
}

function isLocalHostname(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
}

// Decides whether a notification target URL (http(s) webhook or any shoutrrr
// scheme) would reach a private address. Hostnames are resolved and EVERY
// address they resolve to must be public. A hostname that does not resolve is
// allowed: shoutrrr services such as telegram:// or discord:// put a token or a
// service id where the host goes and talk to a fixed public API. A URL that
// cannot be parsed is refused, since its target cannot be checked.
// Comma-separated hostnames an admin trusts even though they resolve to a
// private address (split-horizon DNS, a self-hosted Gotify on the LAN).
// Exact names only, compared case-insensitively.
export function parseAllowedHosts(value) {
  return new Set(String(value ?? '').split(',').map(h => h.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))
}

export async function isPrivateTarget(rawUrl, { lookup = dns.lookup, allowedHosts = new Set() } = {}) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    return true
  }
  let host = url.hostname.replace(/^\[|\]$/g, '')
  // Non-http schemes keep percent-escapes in the host; the shoutrrr CLI decodes them.
  try {
    host = decodeURIComponent(host)
  } catch {
    return true
  }
  if (allowedHosts.has(host.toLowerCase().replace(/\.$/, ''))) return false
  if (isLocalHostname(host)) return true
  if (isIP(host)) return isPrivateAddress(host)
  let addresses
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    return false
  }
  return addresses.some(entry => isPrivateAddress(entry.address))
}
