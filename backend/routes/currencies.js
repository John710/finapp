import cron from 'node-cron'
import fiatCurrencies from '../data/fiatCurrencies.json' with { type: 'json' }

let cryptoListCache = null
let cryptoListCacheTime = 0
const CRYPTO_LIST_CACHE_TTL = 6 * 3600 * 1000 // 6 hours

const FALLBACK_CRYPTO_LIST = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', current_price: null },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', current_price: null },
  { id: 'tether', symbol: 'USDT', name: 'Tether', image: 'https://assets.coingecko.com/coins/images/325/small/Tether.png', current_price: null },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', image: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', current_price: null },
  { id: 'solana', symbol: 'SOL', name: 'Solana', image: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', current_price: null },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', image: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', current_price: null },
  { id: 'usd-coin', symbol: 'USDC', name: 'USDC', image: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png', current_price: null },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', image: 'https://assets.coingecko.com/coins/images/975/small/cardano.png', current_price: null },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', image: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png', current_price: null },
  { id: 'tron', symbol: 'TRX', name: 'TRON', image: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png', current_price: null },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', image: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png', current_price: null },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', image: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png', current_price: null },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', image: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png', current_price: null },
  { id: 'matic-network', symbol: 'MATIC', name: 'Polygon', image: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png', current_price: null },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', image: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png', current_price: null },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', image: 'https://assets.coingecko.com/coins/images/780/small/bitcoin-cash-circle.png', current_price: null },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap', image: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png', current_price: null },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar', image: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png', current_price: null },
  { id: 'monero', symbol: 'XMR', name: 'Monero', image: 'https://assets.coingecko.com/coins/images/69/small/monero_logo.png', current_price: null },
  { id: 'ethereum-classic', symbol: 'ETC', name: 'Ethereum Classic', image: 'https://assets.coingecko.com/coins/images/453/small/ethereum-classic-logo.png', current_price: null }
]

const FALLBACK_SYMBOLS = FALLBACK_CRYPTO_LIST.map(c => c.symbol.toLowerCase()).join(',')

const FAWAZAHMED0_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'

// Fast lookup for valid fiat codes from the hardcoded list
const FIAT_CODES = new Set(fiatCurrencies.map(c => c.code))

function buildHeaders(apiKey) {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'FinanceApp/1.0'
  }
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey
  }
  return headers
}

function isCoinGeckoError(data) {
  return data && typeof data === 'object' && (data.status?.error_code || data.error)
}

async function coingeckoFetch(fastify, path, apiKey, opts = {}) {
  const base = 'https://api.coingecko.com/api/v3'
  // Remove leading slash so URL(base) keeps the /api/v3 prefix
  const cleanPath = path.replace(/^\/+/, '')
  const url = new URL(cleanPath, base + '/').toString()
  const maxAttempts = opts.maxAttempts || 3
  const baseDelay = opts.baseDelay || 5000
  let lastErr = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers: buildHeaders(apiKey) })
      const data = await res.json()

      if (isCoinGeckoError(data)) {
        lastErr = `CoinGecko error body=${JSON.stringify(data).slice(0, 500)}`
        fastify.log.warn(`CoinGecko attempt ${attempt}/${maxAttempts} API error: ${lastErr}`)
      } else if (!res.ok) {
        lastErr = `HTTP ${res.status} ${res.statusText} body=${JSON.stringify(data).slice(0, 500)}`
        fastify.log.warn(`CoinGecko attempt ${attempt}/${maxAttempts} HTTP error: ${lastErr}`)
      } else if (!Array.isArray(data) && typeof data !== 'object') {
        lastErr = `Unexpected response type: ${typeof data}`
        fastify.log.warn(`CoinGecko attempt ${attempt}/${maxAttempts} ${lastErr}`)
      } else {
        return { ok: true, data, status: res.status }
      }

      // Extract retry delay from Retry-After header or use exponential backoff
      const retryAfter = res.headers.get('retry-after')
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : baseDelay * attempt

      if (attempt < maxAttempts) {
        fastify.log.info(`Waiting ${delayMs}ms before retry...`)
        await new Promise(r => setTimeout(r, delayMs))
      }
    } catch (fetchErr) {
      lastErr = fetchErr.message
      fastify.log.warn(`CoinGecko attempt ${attempt}/${maxAttempts} network error: ${lastErr}`)
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelay * attempt))
      }
    }
  }

  return { ok: false, error: lastErr }
}

async function updateExchangeRates(fastify, userId) {
  const fiatRes = await fetch(FAWAZAHMED0_URL, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'FinanceApp/1.0' }
  })
  if (!fiatRes.ok) {
    throw new Error(`Fawazahmed0 HTTP ${fiatRes.status}`)
  }
  const fiatData = await fiatRes.json()
  if (!fiatData || !fiatData.usd || typeof fiatData.usd !== 'object') {
    throw new Error('Invalid Fawazahmed0 response')
  }

  const client = await fastify.db.connect()
  let fiatUpdated = 0
  let cryptoUpdated = 0
  try {
    await client.query('BEGIN')

    // Insert USD→fiat rates only for currencies in our hardcoded fiat list
    for (const code of FIAT_CODES) {
      const lower = code.toLowerCase()
      const rate = fiatData.usd[lower]
      if (typeof rate === 'number') {
        await client.query(
          'INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ($1, $2, $3, $4)',
          ['USD', code, rate, 'fawazahmed0']
        )
        fiatUpdated++
      } else {
        fastify.log.warn(`Fawazahmed0 missing rate for ${code}`)
      }
    }

    try {
      const userRes = await fastify.db.query('SELECT coingecko_api_key FROM users WHERE id = $1', [userId])
      const apiKey = userRes.rows[0]?.coingecko_api_key || process.env.COINGECKO_API_KEY

      // Fetch crypto symbols actually used by accounts, fallback to top list
      const accountRes = await fastify.db.query("SELECT DISTINCT UPPER(currency) as currency FROM accounts WHERE type = 'crypto'")
      const accountSymbols = accountRes.rows.map(r => r.currency.toLowerCase()).filter(Boolean)
      const symbols = accountSymbols.length ? accountSymbols.join(',') : FALLBACK_SYMBOLS
      fastify.log.info(`Updating crypto rates for symbols: ${symbols}`)

      const priceRes = await coingeckoFetch(
        fastify,
        `/simple/price?vs_currencies=usd&symbols=${symbols}`,
        apiKey,
        { maxAttempts: 3, baseDelay: 10000 }
      )
      fastify.log.info(`CoinGecko /simple/price response: ok=${priceRes.ok}, status=${priceRes.status || 'n/a'}, keys=${priceRes.data ? Object.keys(priceRes.data).length : 'n/a'}`)

      if (priceRes.ok && priceRes.data && typeof priceRes.data === 'object' && !Array.isArray(priceRes.data)) {
        for (const [symbol, prices] of Object.entries(priceRes.data)) {
          if (prices && typeof prices === 'object' && typeof prices.usd === 'number') {
            await client.query(
              'INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ($1, $2, $3, $4)',
              [symbol.toUpperCase(), 'USD', prices.usd, 'coingecko']
            )
            cryptoUpdated++
          }
        }

        // Fallback to /coins/markets for symbols missing from /simple/price (e.g. newer coins on demo plan)
        const missingSymbols = accountSymbols.filter(s => !priceRes.data[s])
        if (missingSymbols.length) {
          fastify.log.info(`CoinGecko /simple/price missing symbols: ${missingSymbols.join(',')}, trying /coins/markets fallback`)
          const marketsRes = await coingeckoFetch(
            fastify,
            `/coins/markets?vs_currency=usd&symbols=${missingSymbols.join(',')}&per_page=250`,
            apiKey,
            { maxAttempts: 2, baseDelay: 10000 }
          )
          if (marketsRes.ok && Array.isArray(marketsRes.data)) {
            for (const coin of marketsRes.data) {
              if (coin.current_price != null) {
                await client.query(
                  'INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ($1, $2, $3, $4)',
                  [coin.symbol.toUpperCase(), 'USD', coin.current_price, 'coingecko']
                )
                cryptoUpdated++
              }
            }
          } else {
            fastify.log.warn(`CoinGecko /coins/markets fallback failed for missing symbols: ${marketsRes.error || 'unknown'}`)
          }
        }
      } else {
        fastify.log.warn('CoinGecko price update failed: ' + (priceRes.error || 'unknown'))
      }
    } catch (cryptoErr) {
      fastify.log.warn({ err: cryptoErr }, 'Crypto rates fetch failed, saving fiat only: ' + (cryptoErr?.message || String(cryptoErr)))
    }

    await client.query('COMMIT')
    return { success: true, updated: fiatUpdated + cryptoUpdated, cryptoUpdated, fiatUpdated }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function currencyRoutes(fastify, opts) {
  // List available cryptocurrencies
  fastify.get('/currencies/crypto', async (request, reply) => {
    const now = Date.now()
    if (cryptoListCache && (now - cryptoListCacheTime) < CRYPTO_LIST_CACHE_TTL) {
      return cryptoListCache
    }
    try {
      let apiKey = process.env.COINGECKO_API_KEY
      if (request.user?.userId) {
        try {
          const userRes = await fastify.db.query('SELECT coingecko_api_key FROM users WHERE id = $1', [request.user.userId])
          apiKey = userRes.rows[0]?.coingecko_api_key || apiKey
        } catch (dbErr) {
          fastify.log.warn('Failed to fetch user API key:', dbErr.message)
        }
      }

      const res = await coingeckoFetch(
        fastify,
        '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
        apiKey,
        { maxAttempts: 3, baseDelay: 10000 }
      )

      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
        fastify.log.warn('CoinGecko markets failed, using fallback. Error: ' + res.error)
        reply.header('x-coingecko-rate-limited', 'true')
        if (cryptoListCache) return cryptoListCache
        return FALLBACK_CRYPTO_LIST
      }

      cryptoListCache = res.data.map(c => ({
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        image: c.image
          ? c.image.replace('coin-images.coingecko.com', 'assets.coingecko.com').replace('/large/', '/small/')
          : null,
        current_price: c.current_price
      }))
      cryptoListCacheTime = now
      return cryptoListCache
    } catch (err) {
      fastify.log.error('Failed to fetch crypto list:', err.message)
      reply.header('x-coingecko-rate-limited', 'true')
      if (cryptoListCache) return cryptoListCache
      return FALLBACK_CRYPTO_LIST
    }
  })

  // List available fiat currencies (hardcoded, filtered from Fawazahmed0 + ISO 4217)
  fastify.get('/currencies/fiat', async (request, reply) => {
    return fiatCurrencies
  })

  // List current rates
  fastify.get('/currencies', async (request, reply) => {
    const result = await fastify.db.query(`
      SELECT DISTINCT ON (from_currency, to_currency)
        from_currency, to_currency, rate, source, updated_at
      FROM exchange_rates
      ORDER BY from_currency, to_currency, updated_at DESC
    `)
    if (result.rows.length === 0) {
      fastify.log.info('No exchange rates found, triggering auto-update')
      try {
        const updateResult = await updateExchangeRates(fastify, request.user?.userId)
        if (updateResult.cryptoUpdated === 0) {
          reply.header('x-coingecko-rate-limited', 'true')
        }
        const refreshed = await fastify.db.query(`
          SELECT DISTINCT ON (from_currency, to_currency)
            from_currency, to_currency, rate, source, updated_at
          FROM exchange_rates
          ORDER BY from_currency, to_currency, updated_at DESC
        `)
        return refreshed.rows
      } catch (err) {
        fastify.log.warn('Auto-update of exchange rates failed:', err.message)
        reply.header('x-coingecko-rate-limited', 'true')
      }
    }
    return result.rows
  })

  // Update rates
  fastify.post('/currencies/update', async (request, reply) => {
    try {
      const result = await updateExchangeRates(fastify, request.user?.userId)
      if (result.cryptoUpdated === 0) {
        reply.header('x-coingecko-rate-limited', 'true')
      }
      return result
    } catch (err) {
      reply.code(500)
      reply.header('x-coingecko-rate-limited', 'true')
      return { error: 'Failed to fetch rates', message: err.message }
    }
  })

  // Auto-update exchange rates once per day at 04:00 (Fawazahmed0 updates daily)
  cron.schedule('0 4 * * *', async () => {
    fastify.log.info('Auto-updating exchange rates (daily)')
    try {
      const userRes = await fastify.db.query('SELECT id FROM users ORDER BY id LIMIT 1')
      const userId = userRes.rows[0]?.id
      await updateExchangeRates(fastify, userId)
      fastify.log.info('Exchange rates auto-updated')
    } catch (err) {
      fastify.log.error('Exchange rates auto-update failed:', err.message)
    }
  })
}

export default currencyRoutes
