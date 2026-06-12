import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import cc from 'currency-codes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FAWAZ_NAMES_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.json'
const SYMBOLS_URL = 'https://raw.githubusercontent.com/RubyMoney/money/main/config/currency_iso.json'

const EXCLUDE_CODES = new Set([
  // Funds / units / testing / metals / obsolete
  'BOV', 'CHE', 'CHW', 'CLF', 'COU', 'CUC', 'MXV', 'USN', 'UYI',
  'UYW', 'VED',
  'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XDR', 'XPD', 'XPT',
  'XSU', 'XTS', 'XUA', 'XXX'
])

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'FinApp/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json()
}

function titleCase(str) {
  return str
    .split(/\s+/)
    .map(t => {
      if (!t) return t
      // Preserve fully-uppercase acronyms (e.g. US, CFA, CFP, IMF)
      if (t === t.toUpperCase() && t.length > 1) return t
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
    })
    .join(' ')
}

const SYMBOL_OVERRIDES = {
  CHF: 'Fr',
  MVR: 'ރ',
  RSD: 'din'
}

async function main() {
  const [fawazNames, rubySymbols] = await Promise.all([
    fetchJson(FAWAZ_NAMES_URL),
    fetchJson(SYMBOLS_URL)
  ])

  const symbolsByCode = new Map()
  for (const entry of Object.values(rubySymbols)) {
    if (entry && entry.iso_code) {
      symbolsByCode.set(entry.iso_code, entry.symbol || entry.iso_code)
    }
  }

  const isoCodes = cc.codes().filter(code => !EXCLUDE_CODES.has(code))

  const list = isoCodes
    .map(code => {
      const lower = code.toLowerCase()
      const nameFromFawaz = fawazNames[lower]
      const ccData = cc.code(code)
      let name = nameFromFawaz
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        name = ccData ? ccData.currency : code
      }
      // Clean up names: capitalize each word
      name = titleCase(name)
      const symbol = SYMBOL_OVERRIDES[code] || symbolsByCode.get(code) || code
      return { code, name, symbol }
    })
    .sort((a, b) => a.code.localeCompare(b.code))

  const outPath = path.resolve(__dirname, '../data/fiatCurrencies.json')
  await fs.writeFile(outPath, JSON.stringify(list, null, 2) + '\n', 'utf8')

  console.log(`Generated ${outPath} with ${list.length} currencies`)
  const missingSymbols = list.filter(c => c.symbol === c.code).length
  console.log(`Currencies without dedicated symbol (fallback to code): ${missingSymbols}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
