import { createNotification, sendPushToAll, checkDuplicateNotification } from '../routes/notifications.js'

export async function notify(fastify, userId, { type, title, message, data = {}, channels = [] }) {
  if (!channels.length) return

  const result = { bell: false, push: false, shoutrrr: false }

  try {
    if (channels.includes('bell')) {
      await createNotification(fastify, { userId, type, title, message, data })
      result.bell = true
    }
  } catch (err) {
    fastify.log.warn(err, 'Bell notification failed')
  }

  try {
    if (channels.includes('push')) {
      const payload = JSON.stringify({
        title,
        body: message,
        tag: `${type}-${data.entity_id || Date.now()}`,
        data: { url: data.url || '/' }
      })
      await sendPushToAll(fastify, userId, payload)
      result.push = true
    }
  } catch (err) {
    fastify.log.warn(err, 'Push notification failed')
  }

  try {
    if (channels.includes('shoutrrr') && fastify.sendShoutrrr) {
      const { rows } = await fastify.db.query(
        'SELECT shoutrrr_url FROM users WHERE id = $1',
        [userId]
      )
      const shoutrrrUrl = rows[0]?.shoutrrr_url
      if (shoutrrrUrl) {
        await fastify.sendShoutrrr(shoutrrrUrl, { title: `FinApp: ${title}`, message })
        result.shoutrrr = true
      }
    }
  } catch (err) {
    fastify.log.warn(err, 'Shoutrrr notification failed')
  }

  return result
}

export { checkDuplicateNotification }
