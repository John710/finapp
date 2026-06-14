import webpush from 'web-push'
import { t, getUserLang } from '../services/i18n.js'

export default async function (fastify, opts) {
  fastify.get('/vapid-public-key', async (request, reply) => {
    const userId = request.user?.userId
    if (!userId) return { publicKey: null }
    const { rows } = await fastify.db.query(
      'SELECT vapid_public_key FROM users WHERE id = $1',
      [userId]
    )
    return { publicKey: rows[0]?.vapid_public_key || null }
  })

  fastify.post('/admin/generate-vapid-keys', {
    schema: {
      body: {
        type: 'object',
        required: ['subject'],
        properties: {
          subject: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.userId
    const { subject } = request.body
    const keys = webpush.generateVAPIDKeys()
    const mailtoSubject = `mailto:${subject}`

    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users
         SET vapid_public_key = $1,
             vapid_private_key = $2,
             vapid_subject = $3
         WHERE id = $4`,
        [keys.publicKey, keys.privateKey, mailtoSubject, userId]
      )
      await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId])
      await client.query('COMMIT')
      return { publicKey: keys.publicKey, subject: mailtoSubject }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  fastify.post('/admin/delete-vapid-keys', async (request, reply) => {
    const userId = request.user.userId
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users
         SET vapid_public_key = NULL,
             vapid_private_key = NULL,
             vapid_subject = NULL
         WHERE id = $1`,
        [userId]
      )
      await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId])
      await client.query('COMMIT')
      return { success: true }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
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
         ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
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
    const userId = request.user?.userId
    const client = await fastify.db.connect()
    try {
      await client.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, userId])
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
    const userId = request.user.userId
    const { rows } = await fastify.db.query(
      'SELECT vapid_public_key, vapid_private_key FROM users WHERE id = $1',
      [userId]
    )
    if (!rows[0]?.vapid_public_key || !rows[0]?.vapid_private_key) {
      reply.code(503)
      return { error: 'Push notifications not configured' }
    }
    const lang = await getUserLang(fastify.db, userId)
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
    const lang = await getUserLang(fastify.db, userId)
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
    const userId = request.user.userId
    const { rows } = await fastify.db.query(
      'SELECT shoutrrr_url FROM users WHERE id = $1',
      [userId]
    )
    const shoutrrrUrl = rows[0]?.shoutrrr_url
    if (!shoutrrrUrl || !fastify.sendShoutrrr) {
      reply.code(503)
      return { error: 'Shoutrrr not configured' }
    }
    const lang = await getUserLang(fastify.db, userId)
    await fastify.sendShoutrrr(shoutrrrUrl, {
      title: `FinApp: ${t('notifications.shoutrrr_test', {}, lang)}`,
      message: t('notifications.shoutrrr_test_body', {}, lang)
    })
    return { success: true }
  })
}

export async function sendPushToAll(fastify, userId, payload) {
  const client = await fastify.db.connect()
  try {
    const { rows: userRows } = await client.query(
      'SELECT vapid_public_key, vapid_private_key, vapid_subject FROM users WHERE id = $1',
      [userId]
    )
    const user = userRows[0]
    if (!user?.vapid_public_key || !user?.vapid_private_key) {
      return { sent: 0, failed: 0 }
    }

    const { rows } = await client.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    )
    let sent = 0, failed = 0
    await Promise.all(rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails: {
              subject: user.vapid_subject || 'mailto:admin@localhost',
              publicKey: user.vapid_public_key,
              privateKey: user.vapid_private_key
            }
          }
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
         AND is_read = false AND created_at > NOW() - make_interval(hours => $4)
       LIMIT 1`,
      [userId, type, String(entityId), hours]
    )
    return rows.length > 0
  } finally {
    client.release()
  }
}
