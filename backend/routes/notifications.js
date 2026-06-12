import webpush from 'web-push'
import { t, getUserLang } from '../services/i18n.js'

export default async function (fastify, opts) {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'

  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  }

  fastify.get('/vapid-public-key', async (request, reply) => {
    return { publicKey: vapidPublicKey || null }
  })

  fastify.post('/subscribe', {
    schema: {
      body: {
        type: 'object',
        required: ['subscription'],
        properties: {
          subscription: {
            type: 'object',
            required: ['endpoint', 'keys'],
            properties: {
              endpoint: { type: 'string' },
              keys: {
                type: 'object',
                required: ['p256dh', 'auth'],
                properties: {
                  p256dh: { type: 'string' },
                  auth: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { subscription } = request.body
    const userId = request.user?.userId
    const client = await fastify.db.connect()
    try {
      await client.query(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id`,
        [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userId]
      )
      return { success: true }
    } finally {
      client.release()
    }
  })

  fastify.post('/unsubscribe', {
    schema: {
      body: {
        type: 'object',
        required: ['endpoint'],
        properties: {
          endpoint: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { endpoint } = request.body
    const client = await fastify.db.connect()
    try {
      await client.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
      return { success: true }
    } finally {
      client.release()
    }
  })

  // In-app notifications
  fastify.get('/notifications', async (request, reply) => {
    const userId = request.user.userId
    const limit = parseInt(request.query.limit) || 20
    const offset = parseInt(request.query.offset) || 0
    const type = request.query.type
    const client = await fastify.db.connect()
    try {
      const params = [userId, limit, offset]
      let typeClause = ''
      if (type) {
        typeClause = 'AND type = $4'
        params.push(type)
      }
      const { rows } = await client.query(
        `SELECT * FROM notifications WHERE user_id = $1 ${typeClause} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        params
      )
      const countRes = await client.query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`, [userId])
      return { notifications: rows, unread_count: parseInt(countRes.rows[0].count) }
    } finally {
      client.release()
    }
  })

  fastify.get('/notifications/unread-count', async (request, reply) => {
    const userId = request.user.userId
    const client = await fastify.db.connect()
    try {
      const { rows } = await client.query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`, [userId])
      return { count: parseInt(rows[0].count) }
    } finally {
      client.release()
    }
  })

  fastify.patch('/notifications/:id/read', async (request, reply) => {
    const { id } = request.params
    const userId = request.user.userId
    const client = await fastify.db.connect()
    try {
      await client.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [id, userId])
      return { success: true }
    } finally {
      client.release()
    }
  })

  fastify.delete('/notifications/:id', async (request, reply) => {
    const { id } = request.params
    const userId = request.user.userId
    const client = await fastify.db.connect()
    try {
      await client.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, userId])
      return { success: true }
    } finally {
      client.release()
    }
  })

  fastify.post('/notifications/read-all', async (request, reply) => {
    const userId = request.user.userId
    const client = await fastify.db.connect()
    try {
      await client.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [userId])
      return { success: true }
    } finally {
      client.release()
    }
  })

  fastify.post('/send-test', async (request, reply) => {
    if (!vapidPublicKey || !vapidPrivateKey) {
      reply.code(503)
      return { error: 'Push notifications not configured' }
    }
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db)
    const payload = JSON.stringify({
      title: t('notifications.push_test', {}, lang),
      body: request.body?.message || t('notifications.push_test_body', {}, lang),
      tag: 'test',
      data: { url: '/' }
    })
    const result = await fastify.sendPushToAll(userId, payload)
    return { sent: result.sent, failed: result.failed }
  })

  fastify.post('/send-test-bell', async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db)
    await createNotification(fastify, {
      userId,
      type: 'test',
      title: t('notifications.bell_test', {}, lang),
      message: t('notifications.bell_test_body', {}, lang),
      data: { url: '/' }
    })
    return { success: true }
  })

  fastify.post('/send-test-shoutrrr', async (request, reply) => {
    if (!fastify.sendShoutrrr) {
      reply.code(503)
      return { error: 'Shoutrrr not configured' }
    }
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db)
    await fastify.sendShoutrrr({
      title: `FinApp: ${t('notifications.shoutrrr_test', {}, lang)}`,
      message: t('notifications.shoutrrr_test_body', {}, lang)
    })
    return { success: true }
  })
}

export async function sendPushToAll(fastify, userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { sent: 0, failed: 0 }
  }
  const client = await fastify.db.connect()
  try {
    const { rows } = await client.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    )
    let sent = 0, failed = 0
    await Promise.all(rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        sent++
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await client.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint])
        }
        failed++
      }
    }))
    return { sent, failed }
  } finally {
    client.release()
  }
}

export async function createNotification(fastify, { userId, type, title, message, data = {} }) {
  const client = await fastify.db.connect()
  try {
    const { rows } = await client.query(
      `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, type, title, message, JSON.stringify(data)]
    )
    return rows[0]
  } finally {
    client.release()
  }
}

export async function checkDuplicateNotification(fastify, { userId, type, entityId, hours = 24 }) {
  const client = await fastify.db.connect()
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM notifications
       WHERE user_id = $1 AND type = $2 AND data->>'entity_id' = $3
         AND is_read = false AND created_at > NOW() - INTERVAL '${hours} hours'
       LIMIT 1`,
      [userId, type, String(entityId)]
    )
    return rows.length > 0
  } finally {
    client.release()
  }
}
