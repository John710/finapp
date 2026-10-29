import fp from 'fastify-plugin'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { decrypt } from '../services/crypto.js'
import { isPrivateTarget, parseAllowedHosts } from '../services/network.js'

const execFileAsync = promisify(execFile)

// When true, notification targets (http(s) webhooks AND shoutrrr service URLs)
// that resolve to private/loopback addresses are rejected and webhook redirects
// are not followed (SSRF protection for multi-user deployments). On by
// default; an admin whose users notify services on the local network
// (e.g. a local Gotify) opts out with SHOUTRRR_BLOCK_PRIVATE_TARGETS=false.
export function blockPrivateTargets(value) {
  return !['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase())
}
const BLOCK_PRIVATE_TARGETS = blockPrivateTargets(process.env.SHOUTRRR_BLOCK_PRIVATE_TARGETS)
// Hosts exempt from the guard, e.g. a self-hosted Gotify behind split-horizon DNS
const ALLOWED_HOSTS = parseAllowedHosts(process.env.SHOUTRRR_ALLOWED_HOSTS)

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
      if (BLOCK_PRIVATE_TARGETS && await isPrivateTarget(u, { allowedHosts: ALLOWED_HOSTS })) {
        fastify.log.warn({ url: maskUrl(u) }, 'Shoutrrr target on a private address blocked')
        errors.push(`Target ${maskUrl(u)} is on a private network address, which is not allowed`)
        continue
      }
      if (u.startsWith('http://') || u.startsWith('https://')) {
        // Generic webhook fallback
        try {
          const res = await fetch(u, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, text: `${title}\n${message}` }),
            // A redirect could point the checked public host at a private one
            redirect: BLOCK_PRIVATE_TARGETS ? 'manual' : 'follow',
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
