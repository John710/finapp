import fp from 'fastify-plugin'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
import { decrypt } from '../services/crypto.js'

const execFileAsync = promisify(execFile)

// When true, http(s) webhooks pointing at private/loopback addresses are
// rejected (SSRF protection for multi-user deployments). Off by default:
// self-hosted setups legitimately notify services on their own LAN (e.g. a
// local Gotify), which public hosting would consider SSRF.
const BLOCK_PRIVATE_TARGETS = ['1', 'true', 'yes'].includes(
  String(process.env.SHOUTRRR_BLOCK_PRIVATE_TARGETS || '').toLowerCase()
)

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  const family = isIP(h)
  if (family === 6) {
    return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd') || h === '::'
  }
  if (family !== 4) return false
  const p = h.split('.').map(Number)
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
  if (p[0] === 192 && p[1] === 168) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 169 && p[1] === 254) return true
  return false
}

// Errors from this plugin can surface in API responses; never include the full
// URL — Shoutrrr URLs embed bot tokens and API keys in userinfo/query.
function maskUrl(u) {
  try {
    const p = new URL(u)
    return `${p.protocol}//${p.host}${p.pathname}`
  } catch {
    return 'invalid-url'
  }
}

async function shoutrrrPlugin(fastify, opts) {
  async function sendShoutrrr(encryptedUrl, { title, message }) {
    const url = decrypt(encryptedUrl)
    if (!url) {
      throw new Error('Shoutrrr URL is required')
    }

    const urls = url.split(',').map(u => u.trim()).filter(Boolean)
    const errors = []

    for (const u of urls) {
      if (u.startsWith('http://') || u.startsWith('https://')) {
        // Generic webhook fallback
        let host = null
        try { host = new URL(u).hostname } catch { /* invalid URL, fetch will fail */ }
        if (BLOCK_PRIVATE_TARGETS && isPrivateHost(host)) {
          fastify.log.warn({ host }, 'Shoutrrr webhook to private address blocked')
          errors.push('Webhook to a private network address is not allowed')
          continue
        }
        try {
          const res = await fetch(u, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, text: `${title}\n${message}` }),
            signal: AbortSignal.timeout(15000)
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            fastify.log.warn({ status: res.status, body: text.slice(0, 300) }, 'Shoutrrr webhook failed')
            errors.push(`Webhook ${maskUrl(u)} responded with HTTP ${res.status}`)
          }
        } catch (err) {
          fastify.log.warn({ err: err.message, url: maskUrl(u) }, 'Shoutrrr webhook error')
          errors.push(`Webhook ${maskUrl(u)} failed: ${err.name === 'TimeoutError' ? 'timeout' : 'network error'}`)
        }
        continue
      }

      // Use shoutrrr CLI for all other services (gotify, discord, telegram, slack, email, etc.)
      try {
        const args = ['send', '--url', u, '--message', message]
        if (title) {
          args.push('--title', title)
        }
        await execFileAsync('shoutrrr', args, { timeout: 30000 })
      } catch (err) {
        fastify.log.warn({ stderr: String(err.stderr || '').slice(0, 300), message: err.message }, 'Shoutrrr CLI failed')
        errors.push(`Shoutrrr (${maskUrl(u)}) failed`)
      }
    }

    if (errors.length) {
      throw new Error(errors.join('; '))
    }
  }

  fastify.decorate('sendShoutrrr', sendShoutrrr)
}

export default fp(shoutrrrPlugin, { name: 'shoutrrr' })
