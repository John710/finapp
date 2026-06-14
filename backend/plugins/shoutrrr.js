import fp from 'fastify-plugin'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function shoutrrrPlugin(fastify, opts) {
  async function sendShoutrrr(url, { title, message }) {
    if (!url) {
      throw new Error('Shoutrrr URL is required')
    }

    const urls = url.split(',').map(u => u.trim()).filter(Boolean)
    const errors = []

    for (const u of urls) {
      if (u.startsWith('http://') || u.startsWith('https://')) {
        // Generic webhook fallback
        try {
          const res = await fetch(u, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, text: `${title}\n${message}` })
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            errors.push(`Webhook ${res.status}: ${text}`)
          }
        } catch (err) {
          errors.push(`Webhook error: ${err.message}`)
        }
        continue
      }

      // Use shoutrrr CLI for all other services (gotify, discord, telegram, slack, email, etc.)
      try {
        const args = ['send', '--url', u, '--message', message]
        if (title) {
          args.push('--title', title)
        }
        await execFileAsync('shoutrrr', args)
      } catch (err) {
        fastify.log.warn({ err, url: u }, 'Shoutrrr CLI failed')
        errors.push(`Shoutrrr (${u}): ${err.stderr || err.message || 'unknown error'}`)
      }
    }

    if (errors.length) {
      throw new Error(errors.join('; '))
    }
  }

  fastify.decorate('sendShoutrrr', sendShoutrrr)
}

export default fp(shoutrrrPlugin, { name: 'shoutrrr' })
