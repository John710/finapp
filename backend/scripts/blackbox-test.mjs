// FinApp post-fix verification suite (runs INSIDE the test container)
const BASE = 'http://127.0.0.1:6253/api/v1'
let cookies = { accessToken: null, refreshToken: null }
let PASS = 0, FAIL = 0; const noop = () => {}
const results = []

function ok(name, extra = '') { PASS++; console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`) }
function fail(name, extra = '') { FAIL++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
function assert(name, cond, extra = '') { cond ? ok(name, extra) : fail(name, extra) }
function near(a, b, eps = 0.02) { return Math.abs(parseFloat(a) - parseFloat(b)) <= eps }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Rolling-window pacing for non-auth requests: the report burst would
// otherwise exceed the 100/min GET limit and fail assertions with 429s.
const windows = { get: [], post: [] }
const LIMITS = { get: 60, post: 12 }
async function pace(method, path) {
  if (path.startsWith('/auth/')) return
  const bucket = method === 'GET' ? 'get' : 'post'
  const times = windows[bucket]
  const limit = LIMITS[bucket]
  const now = Date.now()
  while (times.length && now - times[0] > 60000) times.shift()
  if (times.length >= limit) {
    const wait = 60000 - (now - times[0]) + 1000
    console.log(`  ...pacing (${times.length} ${bucket}/min), waiting ${Math.ceil(wait / 1000)}s`)
    await sleep(wait)
    return pace(method, path)
  }
  times.push(Date.now())
}
// reqRetry kept for existing call sites (429s are no longer retried)
async function reqRetry(method, path, opts = {}) { return req(method, path, opts) }

async function req(method, path, { body, auth = true, rawCookie = null } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (rawCookie) headers['Cookie'] = rawCookie
  else if (auth && (cookies.accessToken || cookies.refreshToken)) {
    headers['Cookie'] = [
      cookies.accessToken ? `accessToken=${cookies.accessToken}` : '',
      cookies.refreshToken ? `refreshToken=${cookies.refreshToken}` : ''
    ].filter(Boolean).join('; ')
  }
  await pace(method, path)
  let res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  })
  // GETs occasionally still trip the limiter — wait out and retry once.
  // /auth excluded: its rate-limit test must observe the raw 429.
  if (res.status === 429 && method === 'GET' && !path.startsWith('/auth/')) {
    console.log('  ...GET rate-limited, waiting 61s and retrying')
    await sleep(61000)
    res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    })
  }
  const setCookies = res.headers.getSetCookie?.() || []
  for (const sc of setCookies) {
    const m = sc.match(/^(accessToken|refreshToken)=([^;]+)/)
    if (m) cookies[m[1]] = m[2]
  }
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, text, setCookies }
}


// ---------- A/B: health ----------
{
  const root = await fetch('http://127.0.0.1:6253/health', { signal: AbortSignal.timeout(5000) })
  const rootBody = await root.json()
  assert('GET /health (root) returns JSON', root.status === 200 && rootBody.status === 'ok' && rootBody.db === 'connected')
  const api = await req('GET', '/health', { auth: false })
  assert('GET /api/v1/health ok', api.status === 200 && api.json?.db === 'connected')

  // SPA index + fallback exercise the static setHeaders hook (regression guard
  // for the @fastify/static v10 reply/ServerResponse signature change)
  const index = await fetch('http://127.0.0.1:6253/', { signal: AbortSignal.timeout(5000) })
  const indexText = await index.text()
  assert('GET / serves SPA index', index.status === 200 && indexText.includes('<div id="app">'))
  assert('index.html served with no-cache headers', /no-cache|no-store/.test(index.headers.get('cache-control') || ''), index.headers.get('cache-control'))
  const deep = await fetch('http://127.0.0.1:6253/accounts/42', { signal: AbortSignal.timeout(5000) })
  const deepText = await deep.text()
  assert('SPA fallback for deep routes', deep.status === 200 && deepText.includes('<div id="app">'))
}

// ---------- C: setup flow on empty DB ----------
{
  const before = await req('GET', '/auth/setup-required', { auth: false })
  assert('setup-required=true on empty DB', before.json?.required === true)
  const reg = await req('POST', '/auth/register', { auth: false, body: { login: 'audit_tester', password: 'testpass123', language: 'en' } })
  assert('first user registered', reg.status === 200 && reg.json?.success === true, `status=${reg.status}`)
  const after = await req('GET', '/auth/setup-required', { auth: false })
  assert('setup-required=false after register', after.json?.required === false)
}

// ---------- D: registration closed ----------
{
  const intruder = await req('POST', '/auth/register', { auth: false, body: { login: 'intruder', password: 'testpass123', language: 'ru' } })
  assert('second register rejected 400', intruder.status === 400)
  assert('localized registration_closed (ru)', typeof intruder.json?.error === 'string' && intruder.json.error.includes('Регистрация закрыта'), intruder.json?.error)
}

// ---------- F: rate limit on login ----------
{
  let got429 = false, codes = []
  for (let i = 0; i < 20; i++) {
    const r = await req('POST', '/auth/login', { auth: false, body: { login: 'audit_tester', password: `wrongpass${i}` } })
    codes.push(r.status)
    if (r.status === 429) { got429 = true; break }
  }
  assert('login rate-limited (429 observed)', got429, codes.join(','))
}

// Wait for the per-minute auth window to clear before login-dependent tests
await sleep(65000)

// ---------- E: login + cookie flags + masked secrets ----------
{
  const login = await req('POST', '/auth/login', { auth: false, body: { login: 'audit_tester', password: 'testpass123' } })
  assert('login 200', login.status === 200, `status=${login.status}`)
  assert('login returns masked secret fields + flags', login.json?.user && 'coingecko_api_key_set' in login.json.user && 'shoutrrr_url_set' in login.json.user)
  const sc = login.setCookies.join(' | ')
  assert('cookies HttpOnly', /HttpOnly/i.test(sc))
  assert('cookies SameSite=Strict', /SameSite=Strict/i.test(sc))
}

// ---------- H: accounts ----------
let usdId, eurId, usd2Id, loneId
{
  const mk = async (name, type, currency, balance) => {
    const r = await req('POST', '/accounts', { body: { name, type, currency, balance } })
    return { id: r.json?.id, status: r.status }
  }
  const a = await mk('WalletUSD', 'cash', 'USD', 1000)
  const b = await mk('WalletEUR', 'cash', 'EUR', 500)
  const c = await mk('Wallet2', 'cash', 'USD', 0)
  const d = await mk('Lone', 'cash', 'USD', 432)
  usdId = a.id; eurId = b.id; usd2Id = c.id; loneId = d.id
  assert('4 accounts created', a.status === 201 && b.status === 201 && c.status === 201 && d.status === 201)
}
const getAccounts = async () => (await req('GET', '/accounts')).json
const bal = (accs, id) => parseFloat(accs.find(x => x.id === id).balance)

// ---------- I: currencies update ----------
let eurRate = null
{
  const upd = await fetch(`${BASE}/currencies/update`, {
    method: 'POST',
    headers: { Cookie: `accessToken=${cookies.accessToken}` },
    signal: AbortSignal.timeout(240000)
  })
  const body = await upd.json().catch(() => ({}))
  const list = await req('GET', '/currencies')
  const row = (list.json || []).find(r => r.from_currency === 'USD' && r.to_currency === 'EUR')
  eurRate = row ? parseFloat(row.rate) : null
  assert('USD->EUR rate available after update', eurRate !== null && eurRate > 0, `rate=${eurRate} (updated=${body?.updated ?? '?'} fiat=${body?.fiatUpdated ?? '?'})`)
}

// ---------- J: cross-currency transfer ----------
{
  const tx = await req('POST', '/transactions', { body: { account_id: usdId, amount: 100, type: 'transfer', transfer_to_account_id: eurId, date: '2026-10-20', note: 'cross-currency test' } })
  assert('cross-currency transfer created', tx.status === 201, `status=${tx.status} body=${JSON.stringify(tx.json).slice(0, 200)}`)
  const accs = await getAccounts()
  const list = await req('GET', '/transactions?limit=50')
  const leg = (list.json?.items || []).find(t => t.type === 'income' && t.transfer_to_account_id === usdId && t.account_id === eurId)
  globalThis.leg1 = leg
  assert('paired leg created with pair link', !!leg)
  assert('USD balance after transfer', near(bal(accs, usdId), 900), `${bal(accs, usdId)}`)
  const expectedEur = 500 + parseFloat(leg.amount)
  assert('EUR credited with CONVERTED amount', near(bal(accs, eurId), expectedEur), `bal=${bal(accs, eurId)} leg=${leg.amount} (raw 100 would mean no conversion)`)
  assert('leg amount matches live rate', near(parseFloat(leg.amount), 100 * eurRate, 0.5), `leg=${leg.amount} 100*rate=${(100 * eurRate).toFixed(4)}`)
}

// ---------- K: edit transfer ----------
{
  const upd = await req('PUT', `/transactions/${globalThis.leg1 ? (await (async () => {
    const list = await req('GET', '/transactions?limit=50')
    return (list.json.items.find(t => t.type === 'transfer' && t.transfer_to_account_id === eurId)).id
  })()) : 0}`, { body: { account_id: usdId, amount: 200, type: 'transfer', transfer_to_account_id: eurId, date: '2026-10-20', note: 'cross-currency test' } })
  assert('transfer updated', upd.status === 200, `status=${upd.status}`)
  const accs = await getAccounts()
  assert('USD after edit 900->800', near(bal(accs, usdId), 800), `${bal(accs, usdId)}`)
  const list = await req('GET', '/transactions?limit=50')
  const leg = list.json.items.find(t => t.type === 'income' && t.transfer_to_account_id === usdId && t.account_id === eurId)
  assert('new leg after edit', !!leg && near(parseFloat(leg.amount), 200 * eurRate, 0.5), `leg=${leg?.amount}`)
  assert('EUR after edit = 500 + converted(200)', near(bal(accs, eurId), 500 + parseFloat(leg.amount)), `${bal(accs, eurId)}`)
  globalThis.transferId = list.json.items.find(t => t.type === 'transfer' && t.transfer_to_account_id === eurId).id
}

// ---------- L: delete transfer — the core balance-corruption regression ----------
{
  const del = await req('DELETE', `/transactions/${globalThis.transferId}`)
  assert('transfer deleted', del.status === 204, `status=${del.status}`)
  const accs = await getAccounts()
  assert('USD restored to 1000 after delete', near(bal(accs, usdId), 1000), `${bal(accs, usdId)}`)
  assert('EUR restored to 500 after delete (was double+wrong-currency deduction before fix)', near(bal(accs, eurId), 500), `${bal(accs, eurId)}`)
  const list = await req('GET', '/transactions?limit=50')
  const legs = (list.json.items || []).filter(t => t.type === 'income' && t.transfer_to_account_id === usdId && t.account_id === eurId)
  assert('paired leg removed with transfer', legs.length === 0)
}

// ---------- M: two same-direction transfers, delete one ----------
{
  await req('POST', '/transactions', { body: { account_id: usdId, amount: 100, type: 'transfer', transfer_to_account_id: usd2Id, date: '2026-10-21' } })
  await req('POST', '/transactions', { body: { account_id: usdId, amount: 100, type: 'transfer', transfer_to_account_id: usd2Id, date: '2026-10-22' } })
  let accs = await getAccounts()
  assert('both transfers applied (USD2=200)', near(bal(accs, usd2Id), 200), `${bal(accs, usd2Id)}`)
  const list = await req('GET', '/transactions?limit=50')
  const first = list.json.items.filter(t => t.type === 'transfer' && t.transfer_to_account_id === usd2Id).pop()
  const del = await req('DELETE', `/transactions/${first.id}`)
  assert('one of two transfers deleted', del.status === 204)
  accs = await getAccounts()
  assert('USD2=100 after deleting one (no double leg removal)', near(bal(accs, usd2Id), 100), `${bal(accs, usd2Id)}`)
  const list2 = await req('GET', '/transactions?limit=50')
  const legs = list2.json.items.filter(t => t.type === 'income' && t.account_id === usd2Id && t.transfer_to_account_id === usdId)
  assert('exactly one leg remains', legs.length === 1)
  globalThis.legId = legs[0].id
}

// ---------- N: direct leg mutation blocked ----------
{
  const del = await req('DELETE', `/transactions/${globalThis.legId}`)
  assert('leg delete blocked with 400', del.status === 400, `status=${del.status}`)
  const put = await req('PUT', `/transactions/${globalThis.legId}`, { body: { account_id: usd2Id, amount: 1, type: 'income', date: '2026-10-22' } })
  assert('leg edit blocked with 400', put.status === 400, `status=${put.status}`)
}

// ---------- O/P: input validation ----------
{
  const badId = await reqRetry('DELETE', '/transactions/abc')
  assert('non-numeric :id -> 400 (was 500)', badId.status === 400, `status=${badId.status}`)
  const bigLimit = await req('GET', '/transactions?limit=999999')
  assert('limit=999999 -> 400', bigLimit.status === 400, `status=${bigLimit.status}`)
  const badLimit = await req('GET', '/transactions?limit=abc')
  assert('limit=abc -> 400 (was 500)', badLimit.status === 400, `status=${badLimit.status}`)
  const badDate = await req('GET', '/transactions?from=notadate')
  assert('from=notadate -> 400', badDate.status === 400, `status=${badDate.status}`)
  const noTarget = await reqRetry('POST', '/transactions', { body: { account_id: usdId, amount: 5, type: 'transfer', date: '2026-10-22' } })
  assert('transfer without target -> 400', noTarget.status === 400, `status=${noTarget.status}`)
  const sameAcc = await reqRetry('POST', '/transactions', { body: { account_id: usdId, amount: 5, type: 'transfer', transfer_to_account_id: usdId, date: '2026-10-22' } })
  assert('transfer to same account -> 400 (before insert)', sameAcc.status === 400)
  const zero = await reqRetry('POST', '/transactions', { body: { account_id: usdId, amount: 0, type: 'expense', date: '2026-10-22' } })
  assert('zero amount -> 400', zero.status === 400)
}

// ---------- Q: partial account PUT ----------
{
  const put = await reqRetry('PUT', `/accounts/${loneId}`, { body: { name: 'LoneRenamed', type: 'cash', currency: 'USD' } })
  assert('account PUT without balance ok', put.status === 200, `status=${put.status} body=${JSON.stringify(put.json).slice(0, 100)}`)
  assert('balance preserved (was overwritten with NULL before)', put.json && near(put.json.balance, 432), `${put.json?.balance}`)
}

// ---------- R: change-password ordering ----------
{
  const r = await reqRetry('POST', '/users/change-password', { rawCookie: `accessToken=${cookies.accessToken}`, body: { current_password: 'testpass123', new_password: 'hackerpass1' } })
  assert('change-password without refresh cookie -> 400', r.status === 400, `status=${r.status}`)
  // auth window may be exhausted: probe until clear
  let relogin = { status: 0 }
  for (let i = 0; i < 4; i++) {
    relogin = await req('POST', '/auth/login', { auth: false, body: { login: 'audit_tester', password: 'testpass123' } })
    if (relogin.status !== 429) break
    await sleep(61000)
  }
  assert('OLD password still works (not changed before validation)', relogin.status === 200, `status=${relogin.status}`)
}

// ---------- G: secret masking round-trip ----------
{
  const set = await req('PATCH', '/users/settings', { body: { coingecko_api_key: 'CG-TESTKEY-123456' } })
  assert('coingecko key saved', set.status === 200)
  const me = await req('GET', '/users/me')
  const masked = me.json?.coingecko_api_key
  assert('/users/me returns masked key', typeof masked === 'string' && masked.includes('\u2022') && masked.endsWith('3456'), JSON.stringify(masked))
  assert('/users/me *_set flag', me.json?.coingecko_api_key_set === true)
  const resend = await req('PATCH', '/users/settings', { body: { coingecko_api_key: masked } })
  assert('PATCH with mask accepted (no-op)', resend.status === 200)
  const me2 = await req('GET', '/users/me')
  assert('masked round-trip keeps key set', me2.json?.coingecko_api_key_set === true && me2.json.coingecko_api_key === masked)
  const test = await req('POST', '/users/test-coingecko-key', { body: { coingecko_api_key: masked } })
  assert('masked test-key uses stored key (no "required" 400)', test.status !== 400 || (test.json?.error && !test.json.error.toLowerCase().includes('required')), `status=${test.status}`)
}

// ---------- T: ownership checks ----------
{
  const cat = await req('POST', '/categories', { body: { name: 'AuditCat', type: 'expense' } })
  assert('category created', cat.status === 201)
  const foreignBudget = await req('POST', '/budgets', { body: { category_id: 999999, amount: 100, period: 'month' } })
  assert('budget with foreign category -> 404', foreignBudget.status === 404, `status=${foreignBudget.status}`)
  const foreignRecurring = await req('POST', '/recurring', { body: { account_id: 999999, amount: 10, type: 'expense', frequency: 'monthly', next_date: '2026-11-01' } })
  assert('recurring with foreign account -> 404', foreignRecurring.status === 404, `status=${foreignRecurring.status}`)
}

// ---------- S: net-worth anchored to balances ----------
{
  const nw = await req('GET', '/reports/net-worth?months=2&base_currency=USD')
  const series = nw.json || []
  const last = series[series.length - 1]
  // EUR -> USD is the inverse of the USD -> EUR rate: 500 EUR = 500 / rate USD
  // (USD wallet is 900 here: M left one 100-transfer to USD2 in place)
  const expected = 900 + 100 + 432 + 500 / eurRate
  assert('net-worth anchored to current balances (incl. no-transaction account)', last && near(last.balance, expected, 0.5), `got=${last?.balance} expected=${expected.toFixed(2)}`)
}

console.log(results.join('\n'))
console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`)
process.exit(FAIL > 0 ? 1 : 0)
