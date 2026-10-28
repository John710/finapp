import Papa from 'papaparse'
import Decimal from 'decimal.js'
import { t, getUserLang } from '../services/i18n.js'

// Profile mappings reference literal CSV column headers produced by the bank
// (e.g. Tinkoff exports Russian headers) — these are data format identifiers,
// not translatable UI strings.
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

export const DATE_FORMATS = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']

// Bound the size of a single import transaction (multipart caps the file at 5MB,
// but row counts can still be huge with minified CSVs)
const MAX_IMPORT_ROWS = 20000
// numeric(24,12) holds twelve integer digits.
const MAX_AMOUNT = new Decimal('1e12')
// U+2212, the typographic minus some exports use; built from its code so the
// source stays plain ASCII.
const MINUS_SIGN = String.fromCharCode(0x2212)

/**
 * Parse a bank-formatted amount into a Decimal, or null when it is not a number.
 * Spaces, NBSP and apostrophes are grouping; the LAST separator ('.' or ',') is
 * the decimal point, so "1,234.56", "1.234,56" and "1 234,56" all read 1234.56.
 * A single separator is always the decimal point ("1,5" → 1.5). Grouping must
 * come in threes, so "12.34.5" is garbage rather than a guess.
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null
  // \s already covers NBSP and the narrow NBSP banks use for grouping
  let str = String(raw).trim().replace(/[\s']/g, '').split(MINUS_SIGN).join('-')
  let sign = ''
  if (str.startsWith('-') || str.startsWith('+')) {
    sign = str[0] === '-' ? '-' : ''
    str = str.slice(1)
  }
  if (!/^[\d.,]+$/.test(str) || !/\d/.test(str)) return null

  const lastDot = str.lastIndexOf('.')
  const lastComma = str.lastIndexOf(',')
  const decimalAt = Math.max(lastDot, lastComma)
  let intPart = str
  let fracPart = ''
  if (decimalAt >= 0) {
    const decimalChar = str[decimalAt]
    const count = str.split(decimalChar).length - 1
    // "1,234,567" — the only separator repeats, so it is grouping, not a decimal point
    if (count > 1 && (lastDot < 0 || lastComma < 0)) {
      intPart = str
    } else {
      intPart = str.slice(0, decimalAt)
      fracPart = str.slice(decimalAt + 1)
      if (!/^\d*$/.test(fracPart)) return null
    }
  }
  if (/[.,]/.test(intPart)) {
    const grouping = intPart.match(/[.,]/)[0]
    // One grouping character, groups of three after the first.
    if (intPart.includes(grouping === '.' ? ',' : '.')) return null
    const groups = intPart.split(grouping)
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(g => !/^\d{3}$/.test(g))) return null
    intPart = groups.join('')
  }
  if (intPart === '' && fracPart === '') return null
  const value = new Decimal(`${sign}${intPart || '0'}.${fracPart || '0'}`)
  if (!value.isFinite() || value.abs().gte(MAX_AMOUNT)) return null
  return value
}

function validDay(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/**
 * Parse a CSV date into 'YYYY-MM-DD' or null. ISO dates are unambiguous and
 * always accepted; otherwise `format` decides whether "03/04/2026" is the 3rd of
 * April or the 4th of March. A trailing time ("05.03.2026 12:34:56", as Tinkoff
 * exports) is ignored. Impossible days (31.02) are null, never a rollover.
 */
export function parseDate(raw, format = 'YYYY-MM-DD') {
  const str = String(raw ?? '').trim()
  const time = '(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?$'
  let y, m, d
  const iso = str.match(new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${time}`))
  const local = str.match(new RegExp(`^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})${time}`))
  if (iso) {
    [y, m, d] = iso.slice(1, 4).map(Number)
  } else if (local) {
    const [a, b, year] = local.slice(1, 4).map(Number)
    y = year
    if (format === 'MM/DD/YYYY') {
      m = a
      d = b
    } else {
      d = a
      m = b
    }
  } else {
    return null
  }
  if (!validDay(y, m, d)) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function cell(row, column) {
  if (!column) return null
  const value = row[column]
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  return str === '' ? null : str
}

const shown = value => String(value).slice(0, 40)

/**
 * Turn parsed CSV rows into insertable transactions without touching the
 * database: every row is validated here, so a bad row is reported on its own
 * and can never abort the insert transaction.
 */
export function prepareRows(rows, { mapping, dateFormat, accounts, categories, lang }) {
  const accountsByName = new Map(accounts.map(a => [a.name.toLowerCase(), a]))
  const categoriesByKey = new Map(categories.map(c => [`${c.name.toLowerCase()}|${c.type}`, c]))
  const stats = { created: 0, skipped: 0, uncategorized: 0, errors: [] }
  const prepared = []

  rows.forEach((row, index) => {
    // 1-based data row number, header excluded
    const rowNumber = index + 1
    const fail = (key, params = {}) => stats.errors.push({ row: rowNumber, error: t(`errors.${key}`, params, lang) })

    const dateRaw = cell(row, mapping.date)
    const amountRaw = cell(row, mapping.amount)
    if (!dateRaw || !amountRaw) {
      stats.skipped++
      return
    }

    const amount = parseAmount(amountRaw)
    if (!amount) return fail('import_row_bad_amount', { value: shown(amountRaw) })
    if (amount.isZero()) {
      stats.skipped++
      return
    }

    const date = parseDate(dateRaw, dateFormat)
    if (!date) return fail('import_row_bad_date', { format: dateFormat, value: shown(dateRaw) })

    let type = amount.isPositive() ? 'income' : 'expense'
    const typeRaw = cell(row, mapping.type)
    if (typeRaw) {
      const kind = typeRaw.toLowerCase()
      if (kind === 'income' || kind === 'доход') type = 'income'
      else if (kind === 'expense' || kind === 'расход') type = 'expense'
      else if (kind === 'transfer' || kind === 'перевод') type = 'transfer'
    }
    // A transfer needs a target account the CSV cannot name.
    if (type === 'transfer') return fail('import_row_transfer')

    const accountRaw = cell(row, mapping.account)
    let account
    if (accountRaw) {
      account = accountsByName.get(accountRaw.toLowerCase())
      // Booking a named account's row on some other account would be silent corruption.
      if (!account) return fail('import_row_unknown_account', { name: shown(accountRaw) })
    } else {
      // Deterministic fallback: the oldest account.
      account = accounts[0]
    }
    if (!account) return fail('import_row_no_account')

    const currencyRaw = cell(row, mapping.currency)
    if (currencyRaw && currencyRaw.toUpperCase() !== account.currency) {
      return fail('import_row_currency_mismatch', { currency: shown(currencyRaw.toUpperCase()), account_currency: account.currency })
    }

    // Categories are global: an import maps onto existing ones and never creates any.
    let categoryId = null
    const categoryRaw = cell(row, mapping.category)
    if (categoryRaw) {
      categoryId = categoriesByKey.get(`${categoryRaw.toLowerCase()}|${type}`)?.id ?? null
      if (categoryId === null) stats.uncategorized++
    }

    prepared.push({
      accountId: account.id,
      categoryId,
      amount: amount.abs().toString(),
      type,
      date,
      note: cell(row, mapping.note)
    })
  })

  return { prepared, stats }
}

/** Per-account balance deltas, summed exactly. */
export function balanceDeltas(prepared) {
  const deltas = new Map()
  for (const r of prepared) {
    const signed = new Decimal(r.amount).times(r.type === 'income' ? 1 : -1)
    deltas.set(r.accountId, (deltas.get(r.accountId) ?? new Decimal(0)).plus(signed))
  }
  return deltas
}

async function readUpload(request) {
  let buffer = null
  let rawOptions = null
  // Fields may arrive before or after the file; a file part has to be consumed
  // before the iterator moves on.
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const content = await part.toBuffer()
      if (part.fieldname === 'file' && buffer === null) buffer = content
    } else if (part.fieldname === 'options') {
      rawOptions = part.value
    }
  }
  return { buffer, rawOptions }
}

async function importRoutes(fastify, opts) {
  fastify.get('/import/profiles', async (request, reply) => {
    return Object.entries(PROFILES).map(([key, value]) => ({
      key,
      name: value.name,
      delimiter: value.delimiter,
      dateFormat: value.dateFormat
    }))
  })

  fastify.post('/import/csv', async (request, reply) => {
    const userId = request.user.userId
    const lang = await getUserLang(fastify.db, userId)
    if (!request.isMultipart()) {
      reply.code(400)
      return { error: t('errors.no_file_uploaded', {}, lang) }
    }
    const { buffer, rawOptions } = await readUpload(request)
    if (!buffer) {
      reply.code(400)
      return { error: t('errors.no_file_uploaded', {}, lang) }
    }

    let options = {}
    try {
      options = JSON.parse(rawOptions ?? '{}')
    } catch {
      reply.code(400)
      return { error: t('errors.invalid_options_json', {}, lang) }
    }
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      reply.code(400)
      return { error: t('errors.options_not_object', {}, lang) }
    }
    const profile = Object.hasOwn(PROFILES, String(options.profile)) ? PROFILES[options.profile] : PROFILES.default
    // The SPA sends every mapping key, unset ones as null: those fall back to the profile.
    const mapping = { ...profile.mapping }
    if (options.mapping && typeof options.mapping === 'object') {
      for (const [key, column] of Object.entries(options.mapping)) {
        if (Object.hasOwn(mapping, key) && typeof column === 'string' && column !== '') mapping[key] = column
      }
    }
    const delimiter = typeof options.delimiter === 'string' && options.delimiter ? options.delimiter : profile.delimiter
    const dateFormat = options.dateFormat || profile.dateFormat
    if (!DATE_FORMATS.includes(dateFormat)) {
      reply.code(400)
      return { error: t('errors.import_unsupported_date_format', { format: shown(dateFormat) }, lang) }
    }

    const parseResult = Papa.parse(buffer.toString('utf-8'), {
      header: true,
      skipEmptyLines: true,
      delimiter
    })

    // Anything but an explicit `false` is a preview: a preview must never write.
    if (options.previewOnly !== false) {
      return { preview: parseResult.data.slice(0, 5), headers: parseResult.meta.fields }
    }

    const rows = parseResult.data.slice(0, MAX_IMPORT_ROWS)

    // Deterministic order so the "account not specified" fallback always picks
    // the same (oldest) account instead of a random one.
    const accountsRes = await fastify.db.query('SELECT id, name, currency FROM accounts WHERE user_id = $1 ORDER BY id', [userId])
    const categoriesRes = await fastify.db.query('SELECT id, name, type FROM categories')
    const { prepared, stats } = prepareRows(rows, {
      mapping, dateFormat, accounts: accountsRes.rows, categories: categoriesRes.rows, lang
    })

    if (prepared.length > 0) {
      const client = await fastify.db.connect()
      try {
        await client.query('BEGIN')
        // Bulk-insert in chunks: one multi-row INSERT per 500 rows instead of
        // 2 statements per row (a 20k import used to be 40k round trips).
        const CHUNK = 500
        for (let i = 0; i < prepared.length; i += CHUNK) {
          const chunk = prepared.slice(i, i + CHUNK)
          const placeholders = chunk
            .map((_, j) => `($${j * 7 + 1}, $${j * 7 + 2}, $${j * 7 + 3}, $${j * 7 + 4}, $${j * 7 + 5}, $${j * 7 + 6}, $${j * 7 + 7})`)
            .join(', ')
          const params = chunk.flatMap(r => [userId, r.accountId, r.categoryId, r.amount, r.type, r.date, r.note])
          await client.query(
            `INSERT INTO transactions (user_id, account_id, category_id, amount, type, date, note) VALUES ${placeholders}`,
            params
          )
        }
        // One UPDATE per touched account
        for (const [accountId, delta] of balanceDeltas(prepared)) {
          await client.query(
            'UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
            [delta.toString(), accountId, userId]
          )
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }
    stats.created = prepared.length

    return { stats, total: rows.length }
  })
}

export default importRoutes
