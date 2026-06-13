import Papa from 'papaparse'

const PROFILES = {
  default: {
    name: 'Default',
    delimiter: ';',
    dateFormat: 'YYYY-MM-DD',
    mapping: {
      date: 'date',
      amount: 'amount',
      type: 'type',
      category: 'category',
      account: 'account',
      note: 'note',
      currency: 'currency'
    }
  },
  tinkoff: {
    name: 'Tinkoff',
    delimiter: ';',
    dateFormat: 'DD.MM.YYYY',
    mapping: {
      date: 'Дата операции',
      amount: 'Сумма операции',
      type: null,
      category: 'Категория',
      account: null,
      note: 'Описание',
      currency: 'Валюта операции'
    }
  }
}

async function importRoutes(fastify, opts) {
  fastify.get('/import/profiles', async (request, reply) => {
    return Object.entries(PROFILES).map(([key, value]) => ({
      key,
      name: value.name,
      delimiter: value.delimiter
    }))
  })

  fastify.post('/import/csv', async (request, reply) => {
    const userId = request.user.userId
    const data = await request.file()
    if (!data) {
      reply.code(400)
      return { error: 'No file uploaded' }
    }

    const options = JSON.parse(request.body?.options?.value || '{}')
    const profileKey = options.profile || 'default'
    const profile = PROFILES[profileKey] || PROFILES.default
    const mapping = options.mapping || profile.mapping
    const delimiter = options.delimiter || profile.delimiter || ';'
    const dateFormat = options.dateFormat || profile.dateFormat || 'YYYY-MM-DD'

    const buffer = await data.toBuffer()
    const csvText = buffer.toString('utf-8')

    const parseResult = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      delimiter
    })

    const rows = parseResult.data
    const preview = rows.slice(0, 5)

    if (options.previewOnly) {
      return { preview, headers: parseResult.meta.fields }
    }

    const client = await fastify.db.connect()
    const stats = { created: 0, errors: [], skipped: 0 }

    try {
      await client.query('BEGIN')

      const accountsRes = await client.query('SELECT id, name, currency FROM accounts WHERE user_id = $1', [userId])
      const accountsMap = new Map(accountsRes.rows.map(a => [a.name.toLowerCase(), a]))

      const categoriesRes = await client.query('SELECT id, name, type FROM categories WHERE user_id = $1', [userId])
      const categoriesMap = new Map(categoriesRes.rows.map(c => [c.name.toLowerCase(), c]))

      for (const row of rows) {
        try {
          const dateRaw = row[mapping.date]
          const amountRaw = row[mapping.amount]
          const typeRaw = mapping.type ? row[mapping.type] : null
          const categoryRaw = mapping.category ? row[mapping.category] : null
          const accountRaw = mapping.account ? row[mapping.account] : null
          const noteRaw = mapping.note ? row[mapping.note] : null
          const currencyRaw = mapping.currency ? row[mapping.currency] : null

          if (!dateRaw || !amountRaw) {
            stats.skipped++
            continue
          }

          const amount = parseFloat(String(amountRaw).replace(/\s/g, '').replace(',', '.'))
          if (isNaN(amount) || amount === 0) {
            stats.skipped++
            continue
          }

          let date = parseDate(dateRaw, dateFormat)
          if (!date) {
            stats.skipped++
            continue
          }

          let type = 'expense'
          if (typeRaw) {
            const t = String(typeRaw).toLowerCase()
            if (t === 'income' || t === 'доход') type = 'income'
            else if (t === 'expense' || t === 'расход') type = 'expense'
            else if (t === 'transfer' || t === 'перевод') type = 'transfer'
            else if (amount > 0) type = 'income'
          } else if (amount > 0) {
            type = 'income'
          }

          let accountId = null
          let currency = 'USD'
          if (accountRaw) {
            const acc = accountsMap.get(String(accountRaw).toLowerCase())
            if (acc) {
              accountId = acc.id
              currency = acc.currency
            }
          }
          if (!accountId && accountsRes.rows.length > 0) {
            accountId = accountsRes.rows[0].id
            currency = accountsRes.rows[0].currency
          }
          if (!accountId) {
            stats.errors.push({ row: row[mapping.date] || '?', error: 'No account found' })
            continue
          }

          let categoryId = null
          if (categoryRaw) {
            const cat = categoriesMap.get(String(categoryRaw).toLowerCase())
            if (cat) {
              categoryId = cat.id
            } else {
              const newCat = await client.query(
                'INSERT INTO categories (user_id, name, type, color, icon) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [userId, String(categoryRaw), type, '#94a3b8', 'tag']
              )
              categoryId = newCat.rows[0].id
              categoriesMap.set(String(categoryRaw).toLowerCase(), { id: categoryId, name: categoryRaw, type })
            }
          }

          if (currencyRaw) {
            currency = String(currencyRaw).toUpperCase()
          }

          const txRes = await client.query(
            'INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [userId, accountId, categoryId, Math.abs(amount), type, date, noteRaw || null]
          )

          const sign = type === 'income' ? 1 : -1
          await client.query(
            'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
            [Math.abs(amount) * sign, accountId, userId]
          )

          stats.created++
        } catch (err) {
          stats.errors.push({ row: row[mapping.date] || '?', error: err.message })
        }
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return { stats, total: rows.length }
  })
}

function parseDate(raw, format) {
  const str = String(raw).trim()
  if (!str) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str

  const ddmmyyyy = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const ddmmyyyy2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (ddmmyyyy2) {
    const [, d, m, y] = ddmmyyyy2
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const mmddyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyy && format === 'MM/DD/YYYY') {
    const [, m, d, y] = mmddyyyy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const d = new Date(str)
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('sv-SE')
  }

  return null
}

export default importRoutes
