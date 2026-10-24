import 'dotenv/config'
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dbPlugin from './plugins/db.js'
import authPlugin from './plugins/auth.js'
import cronPlugin from './plugins/cron.js'
import shoutrrrPlugin from './plugins/shoutrrr.js'
import healthRoutes from './routes/health.js'
import authRoutes from './routes/auth.js'
import configRoutes from './routes/config.js'
import accountRoutes from './routes/accounts.js'
import categoryRoutes from './routes/categories.js'
import transactionRoutes from './routes/transactions.js'
import budgetRoutes from './routes/budgets.js'
import debtRoutes from './routes/debts.js'
import recurringRoutes from './routes/recurring.js'
import currencyRoutes from './routes/currencies.js'
import reportRoutes from './routes/reports.js'
import tagRoutes from './routes/tags.js'
import exportRoutes from './routes/export.js'
import importRoutes from './routes/import.js'
import notificationRoutes from './routes/notifications.js'
import demodataRoutes from './routes/demodata.js'
import { sendPushToAll, createNotification } from './routes/notifications.js'
import { notify } from './services/notify.js'
import multipart from '@fastify/multipart'
import { validateEncryptionKey } from './services/crypto.js'

// Fail fast if encryption key is missing or invalid
validateEncryptionKey()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '6253', 10)
const NODE_ENV = process.env.NODE_ENV || 'development'
const isProduction = NODE_ENV === 'production'

const trustedProxies = process.env.TRUSTED_PROXIES
  ? process.env.TRUSTED_PROXIES.split(',').map(s => s.trim())
  : false

async function start() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug')
    },
    trustProxy: trustedProxies,
    disableRequestLogging: true
  })

  // Static files (production build) — register BEFORE rate-limit so assets are not throttled
  const staticPath = path.join(__dirname, 'public')
  await app.register(fastifyStatic, {
    root: staticPath,
    prefix: '/',
    wildcard: false,
    setHeaders: (res, path) => {
      if (path.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      }
    }
  })

  // Security
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.coingecko.com', 'https://cdn.jsdelivr.net', 'https://api.github.com'],
        fontSrc: ["'self'", 'https:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    // These isolation headers require a secure context (HTTPS/localhost).
    // Disable them so the app works over plain HTTP on a private IP.
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
    // HSTS is intentionally disabled here. For HTTPS deployments it should be
    // configured in the reverse proxy (Traefik/Nginx/Caddy).
    strictTransportSecurity: false
  })

  // Rate limit
  // NOTE: Fastify 5 removed `req.routerPath` — it silently evaluates to undefined,
  // which used to make allowList() return true for every request (no limiting at all).
  // `req.routeOptions.url` (available in the onRequest hook for matched routes) is the
  // correct property; unmatched routes (404) stay unlimited.
  await app.register(rateLimit, {
    max: async (req, key) => {
      if (req.routeOptions?.url?.startsWith('/api/v1/auth')) return 10
      if (req.method === 'GET') return 100
      return 30
    },
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: (req, key) => {
      if (!req.routeOptions?.url?.startsWith('/api/v1')) return true
      return false
    }
  })

  // Cookies
  await app.register(cookie)

  // CORS (conditional)
  const allowedOrigins = process.env.ALLOWED_ORIGINS
  if (allowedOrigins) {
    await app.register(cors, {
      origin: allowedOrigins.split(',').map(s => s.trim()),
      credentials: true
    })
  }

  // Database
  await app.register(dbPlugin)

  // Auth (JWT decorators)
  await app.register(authPlugin)

  // Decorators used by cron/handlers must be available before they are registered
  app.decorate('notify', async (userId, payload) => notify(app, userId, payload))
  app.decorate('sendPushToAll', async (userId, payload) => sendPushToAll(app, userId, payload))
  app.decorate('createNotification', async (payload) => createNotification(app, payload))

  // Cron (recurring transactions)
  await app.register(cronPlugin)

  // Shoutrrr (external notifications)
  await app.register(shoutrrrPlugin)

  // Multipart uploads
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })

  // API routes
  // /health is also exposed at the root: the Docker/compose healthchecks hit
  // http://localhost:PORT/health, and without this route they only ever saw
  // the SPA fallback (HTTP 200) and never verified the database connection.
  await app.register(healthRoutes)
  await app.register(healthRoutes, { prefix: '/api/v1' })
  await app.register(configRoutes, { prefix: '/api/v1' })
  await app.register(authRoutes, { prefix: '/api/v1' })
  await app.register(accountRoutes, { prefix: '/api/v1' })
  await app.register(categoryRoutes, { prefix: '/api/v1' })
  await app.register(transactionRoutes, { prefix: '/api/v1' })
  await app.register(budgetRoutes, { prefix: '/api/v1' })
  await app.register(debtRoutes, { prefix: '/api/v1' })
  await app.register(recurringRoutes, { prefix: '/api/v1' })
  await app.register(currencyRoutes, { prefix: '/api/v1' })
  await app.register(reportRoutes, { prefix: '/api/v1' })
  await app.register(exportRoutes, { prefix: '/api/v1' })
  await app.register(tagRoutes, { prefix: '/api/v1' })
  await app.register(importRoutes, { prefix: '/api/v1' })
  await app.register(notificationRoutes, { prefix: '/api/v1' })
  await app.register(demodataRoutes, { prefix: '/api/v1' })

  // Page access logging (skip API, static assets and healthcheck)
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url
    const isStatic = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json|map)(\?.*)?$/.test(url)
    if (url !== '/health' && !url.startsWith('/api/') && !isStatic) {
      app.log.info({ method: request.method, url, ip: request.ip }, 'Page request')
    }
  })

  // SPA fallback and API 404
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' })
    }
    return reply.sendFile('index.html', staticPath)
  })

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    app.log.info(`Server listening on http://0.0.0.0:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
