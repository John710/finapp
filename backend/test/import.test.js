import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import importRoutes, { parseAmount, parseDate, prepareRows, balanceDeltas } from '../routes/import.js'
import { buildStubDb, TEST_USER as USER } from './helpers/stub-db.js'

describe('parseAmount', () => {
  const cases = [
    ['1234.56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234.56', '1234.56'],
    ["1'234.56", '1234.56'],
    ['1,234,567', '1234567'],
    ['1.234.567,89', '1234567.89'],
    ['-1 234,56', '-1234.56'],
    ['−1234,56', '-1234.56'],
    ['+15', '15'],
    ['1,5', '1.5'],
    ['0,10', '0.1'],
    ['.5', '0.5']
  ]
  for (const [raw, expected] of cases) {
    it(`reads ${JSON.stringify(raw)} as ${expected}`, () => {
      expect(parseAmount(raw).toString()).toBe(expected)
    })
  }

  for (const raw of ['abc', '12abc', '1e5', '$100', '12.34.5', '1,2.3,4', '1.23,456.7', '--5', '', '-', '1,23,456', '1000000000000']) {
    it(`rejects ${JSON.stringify(raw)}`, () => {
      expect(parseAmount(raw)).toBeNull()
    })
  }

  it('keeps every digit — no float rounding', () => {
    expect(parseAmount('0,1').plus(parseAmount('0,2')).toString()).toBe('0.3')
    expect(parseAmount('123456789012,123456789012').toString()).toBe('123456789012.123456789012')
  })
})

describe('parseDate', () => {
  it('always accepts ISO dates', () => {
    expect(parseDate('2026-03-05', 'DD.MM.YYYY')).toBe('2026-03-05')
    expect(parseDate('2026-3-5', 'MM/DD/YYYY')).toBe('2026-03-05')
  })

  it('reads day-first for DD formats and month-first only for MM/DD/YYYY', () => {
    expect(parseDate('03/04/2026', 'DD/MM/YYYY')).toBe('2026-04-03')
    expect(parseDate('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04')
    expect(parseDate('05.03.2026', 'DD.MM.YYYY')).toBe('2026-03-05')
    expect(parseDate('12/31/2026', 'MM/DD/YYYY')).toBe('2026-12-31')
  })

  it('ignores the time a bank export appends', () => {
    expect(parseDate('05.03.2026 12:34:56', 'DD.MM.YYYY')).toBe('2026-03-05')
    expect(parseDate('2026-03-05T08:00', 'YYYY-MM-DD')).toBe('2026-03-05')
  })

  it('refuses impossible days instead of rolling them over', () => {
    expect(parseDate('31.02.2026', 'DD.MM.YYYY')).toBeNull()
    expect(parseDate('2026-13-01', 'YYYY-MM-DD')).toBeNull()
    expect(parseDate('12/31/2026', 'DD/MM/YYYY')).toBeNull()
    expect(parseDate('29.02.2025', 'DD.MM.YYYY')).toBeNull()
    expect(parseDate('29.02.2024', 'DD.MM.YYYY')).toBe('2024-02-29')
  })

  it('refuses free text', () => {
    expect(parseDate('March 5, 2026', 'YYYY-MM-DD')).toBeNull()
    expect(parseDate('yesterday', 'YYYY-MM-DD')).toBeNull()
    expect(parseDate('', 'YYYY-MM-DD')).toBeNull()
  })
})

const MAPPING = { date: 'date', amount: 'amount', type: 'type', category: 'category', account: 'account', note: 'note', currency: 'currency' }
const ACCOUNTS = [{ id: 3, name: 'Card', currency: 'RUB' }, { id: 4, name: 'Dollars', currency: 'USD' }]
const CATEGORIES = [{ id: 10, name: 'Groceries', type: 'expense' }, { id: 11, name: 'Salary', type: 'income' }]

function prepare(rows, overrides = {}) {
  return prepareRows(rows, { mapping: MAPPING, dateFormat: 'DD.MM.YYYY', accounts: ACCOUNTS, categories: CATEGORIES, lang: 'en', ...overrides })
}

describe('prepareRows', () => {
  it('books a valid row on the named account with an exact amount', () => {
    const { prepared, stats } = prepare([
      { date: '05.03.2026', amount: '-1 234,56', category: 'groceries', account: 'card', currency: 'rub', note: 'Shop' }
    ])
    expect(stats.errors).toEqual([])
    expect(prepared).toEqual([
      { accountId: 3, categoryId: 10, amount: '1234.56', type: 'expense', date: '2026-03-05', note: 'Shop' }
    ])
  })

  it('reports garbage amounts and impossible dates per row and keeps the good rows', () => {
    const { prepared, stats } = prepare([
      { date: '05.03.2026', amount: '12abc' },
      { date: '31.02.2026', amount: '10' },
      { date: '06.03.2026', amount: '10' }
    ])
    expect(prepared).toHaveLength(1)
    expect(stats.errors.map(e => e.row)).toEqual([1, 2])
    expect(stats.errors[0].error).toMatch('12abc')
    expect(stats.errors[1].error).toMatch('DD.MM.YYYY')
  })

  it('rejects a row whose currency is not the account currency', () => {
    const { prepared, stats } = prepare([{ date: '05.03.2026', amount: '-10', account: 'Card', currency: 'USD' }])
    expect(prepared).toEqual([])
    expect(stats.errors).toHaveLength(1)
    expect(stats.errors[0].error).toMatch('USD')
    expect(stats.errors[0].error).toMatch('RUB')
  })

  it('accepts a row in the matching account currency', () => {
    const { prepared } = prepare([{ date: '05.03.2026', amount: '-10', account: 'Dollars', currency: 'usd' }])
    expect(prepared[0].accountId).toBe(4)
  })

  it('rejects transfers, which name no target account', () => {
    const { prepared, stats } = prepare([{ date: '05.03.2026', amount: '10', type: 'transfer' }, { date: '05.03.2026', amount: '10', type: 'Перевод' }])
    expect(prepared).toEqual([])
    expect(stats.errors).toHaveLength(2)
  })

  it('rejects a row naming an account the user does not have instead of booking it elsewhere', () => {
    const { prepared, stats } = prepare([{ date: '05.03.2026', amount: '10', account: 'Savings' }])
    expect(prepared).toEqual([])
    expect(stats.errors[0].error).toMatch('Savings')
  })

  it('falls back to the oldest account when the row names none', () => {
    const { prepared } = prepare([{ date: '05.03.2026', amount: '10' }])
    expect(prepared[0].accountId).toBe(3)
  })

  it('reports a row error when the user has no account at all', () => {
    const { stats } = prepare([{ date: '05.03.2026', amount: '10' }], { accounts: [] })
    expect(stats.errors).toHaveLength(1)
  })

  it('maps categories by name and type and leaves unknown ones uncategorized', () => {
    const { prepared, stats } = prepare([
      { date: '05.03.2026', amount: '-5', category: 'GROCERIES' },
      { date: '05.03.2026', amount: '-5', category: 'Salary' }, // exists, but as an income category
      { date: '05.03.2026', amount: '-5', category: 'Brand new' }
    ])
    expect(prepared.map(r => r.categoryId)).toEqual([10, null, null])
    expect(stats.uncategorized).toBe(2)
    expect(stats.errors).toEqual([])
  })

  it('skips rows without date or amount, and zero amounts', () => {
    const { prepared, stats } = prepare([{ date: '', amount: '10' }, { date: '05.03.2026', amount: '' }, { date: '05.03.2026', amount: '0,00' }])
    expect(prepared).toEqual([])
    expect(stats.skipped).toBe(3)
    expect(stats.errors).toEqual([])
  })

  it('derives the type from the sign when the type column is unknown', () => {
    const { prepared } = prepare([{ date: '05.03.2026', amount: '7', type: 'purchase' }, { date: '05.03.2026', amount: '-7' }])
    expect(prepared.map(r => r.type)).toEqual(['income', 'expense'])
    expect(prepared.map(r => r.amount)).toEqual(['7', '7'])
  })
})

describe('balanceDeltas', () => {
  it('sums per account in decimals', () => {
    const deltas = balanceDeltas([
      { accountId: 3, amount: '0.1', type: 'income' },
      { accountId: 3, amount: '0.2', type: 'income' },
      { accountId: 3, amount: '1', type: 'expense' },
      { accountId: 4, amount: '5', type: 'expense' }
    ])
    expect(deltas.get(3).toString()).toBe('-0.7')
    expect(deltas.get(4).toString()).toBe('-5')
  })
})

const BOUNDARY = '----finappTestBoundary'

function multipartBody(parts) {
  const chunks = []
  for (const part of parts) {
    if (part.file !== undefined) {
      chunks.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"; filename="import.csv"\r\nContent-Type: text/csv\r\n\r\n${part.file}\r\n`)
    } else {
      chunks.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`)
    }
  }
  chunks.push(`--${BOUNDARY}--\r\n`)
  return Buffer.from(chunks.join(''), 'utf-8')
}

async function importServer() {
  const { db, queries } = buildStubDb([
    { match: /FROM accounts/, rows: () => ACCOUNTS },
    { match: /FROM categories/, rows: () => CATEGORIES }
  ])
  const app = Fastify()
  app.decorate('db', db)
  app.addHook('preHandler', async request => {
    request.user = { userId: USER }
  })
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
  await app.register(importRoutes)
  return { app, queries }
}

const CSV = 'date;amount;category;account;currency\n05.03.2026;-1 234,56;Groceries;Card;RUB\n06.03.2026;-10;Food;Dollars;EUR\n'
const OPTIONS = previewOnly => JSON.stringify({ profile: 'default', delimiter: ';', dateFormat: 'DD.MM.YYYY', mapping: {}, previewOnly })

function post(app, parts) {
  return app.inject({
    method: 'POST',
    url: '/import/csv',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartBody(parts)
  })
}

const writes = queries => queries.filter(q => /^(BEGIN|INSERT|UPDATE|DELETE)/.test(q.sql))

describe('POST /import/csv', () => {
  it('previews without writing when the options come after the file', async () => {
    const { app, queries } = await importServer()
    const res = await post(app, [{ name: 'file', file: CSV }, { name: 'options', value: OPTIONS(true) }])
    expect(res.statusCode).toBe(200)
    expect(res.json().headers).toEqual(['date', 'amount', 'category', 'account', 'currency'])
    expect(res.json().preview).toHaveLength(2)
    expect(writes(queries)).toEqual([])
    await app.close()
  })

  it('previews without writing when the options come first', async () => {
    const { app, queries } = await importServer()
    const res = await post(app, [{ name: 'options', value: OPTIONS(true) }, { name: 'file', file: CSV }])
    expect(res.statusCode).toBe(200)
    expect(res.json().preview).toHaveLength(2)
    expect(writes(queries)).toEqual([])
    await app.close()
  })

  it('treats a request without options as a preview', async () => {
    const { app, queries } = await importServer()
    const res = await post(app, [{ name: 'file', file: CSV }])
    expect(res.statusCode).toBe(200)
    expect(res.json().preview).toBeDefined()
    expect(writes(queries)).toEqual([])
    await app.close()
  })

  it('imports the valid rows and reports the rest, never creating categories', async () => {
    const { app, queries } = await importServer()
    const res = await post(app, [{ name: 'file', file: CSV }, { name: 'options', value: OPTIONS(false) }])
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.stats.created).toBe(1)
    expect(body.stats.skipped).toBe(0)
    expect(body.stats.uncategorized).toBe(0)
    expect(body.stats.errors).toEqual([{ row: 2, error: expect.stringContaining('EUR') }])
    expect(queries.some(q => /INSERT INTO categories/.test(q.sql))).toBe(false)
    const insert = queries.find(q => /INSERT INTO transactions/.test(q.sql))
    expect(insert.params).toEqual([USER, 3, 10, '1234.56', 'expense', '2026-03-05', null])
    const balance = queries.find(q => /UPDATE accounts SET balance/.test(q.sql))
    expect(balance.params).toEqual(['-1234.56', 3, USER])
    expect(queries.some(q => q.sql === 'COMMIT')).toBe(true)
    await app.close()
  })

  it('opens no transaction when no row is valid', async () => {
    const { app, queries } = await importServer()
    const res = await post(app, [{ name: 'options', value: OPTIONS(false) }, { name: 'file', file: 'date;amount\nnope;1\n' }])
    expect(res.statusCode).toBe(200)
    expect(res.json().stats.errors).toHaveLength(1)
    expect(writes(queries)).toEqual([])
    await app.close()
  })

  it('refuses a date format it cannot honour', async () => {
    const { app, queries } = await importServer()
    const options = JSON.stringify({ dateFormat: 'YY/MM/DD', previewOnly: false })
    const res = await post(app, [{ name: 'options', value: options }, { name: 'file', file: CSV }])
    expect(res.statusCode).toBe(400)
    expect(writes(queries)).toEqual([])
    await app.close()
  })

  it('answers 400 without a file', async () => {
    const { app } = await importServer()
    const res = await post(app, [{ name: 'options', value: OPTIONS(false) }])
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('answers 400 for malformed options', async () => {
    const { app } = await importServer()
    const res = await post(app, [{ name: 'file', file: CSV }, { name: 'options', value: '{nope' }])
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
