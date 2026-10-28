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
  const series = Array.isArray(nw.json) ? nw.json : []
  if (!series.length) {
    console.log(`  ...net-worth diagnostic: status=${nw.status} body=${String(nw.text).slice(0, 300)}`)
  }
  const last = series[series.length - 1]
  // EUR -> USD is the inverse of the USD -> EUR rate: 500 EUR = 500 / rate USD
  // (USD wallet is 900 here: M left one 100-transfer to USD2 in place)
  const expected = 900 + 100 + 432 + 500 / eurRate
  assert('net-worth anchored to current balances (incl. no-transaction account)', last && near(last.balance, expected, 0.5), `got=${last?.balance} expected=${expected.toFixed(2)}`)
}

// ---------- U: recurring subscriptions ----------
// Deliberately last: it writes transactions and moves balances, and section S
// asserts an exact net-worth figure.
{
  const wallet = await req('POST', '/accounts', { body: { name: 'RecurringWallet', type: 'cash', currency: 'USD', balance: 1000 } })
  assert('recurring wallet created', wallet.status === 201, `status=${wallet.status}`)
  const ruleAcc = wallet.json?.id
  let ruleId = null

  const occs = async (from, to) => {
    const r = await req('GET', `/recurring/occurrences?from=${from}&to=${to}`)
    const list = (r.json?.occurrences || []).filter(o => o.rule_id === ruleId)
    return { status: r.status, body: r.json, list }
  }
  const datesOf = (list) => list.map(o => o.date)

  // Anchor day must survive short months (the old next_date + INTERVAL ratchet did not).
  // All fixtures start in 2027 so the expected dates do not depend on the container clock.
  const created = await req('POST', '/recurring', {
    body: { account_id: ruleAcc, amount: 20, type: 'expense', interval_unit: 'month', interval_value: 1, start_date: '2027-01-31', note: 'Audit Sub' }
  })
  ruleId = created.json?.id
  assert('monthly rule created', created.status === 201 && !!ruleId, `status=${created.status} body=${JSON.stringify(created.json).slice(0, 160)}`)
  assert('anchor day derived from start_date', created.json?.billing_anchor_day === 31, `${created.json?.billing_anchor_day}`)
  assert('legacy frequency kept in sync', created.json?.frequency === 'monthly', `${created.json?.frequency}`)
  assert('future start_date becomes the first occurrence', created.json?.next_date === '2027-01-31', `${created.json?.next_date}`)
  assert('dates come back as text, not Date objects', typeof created.json?.start_date === 'string', `${typeof created.json?.start_date}`)

  const jan = await occs('2027-01-01', '2027-04-30')
  assert('occurrences window ok', jan.status === 200, `status=${jan.status}`)
  assert('31st clamps per short month without ratcheting', JSON.stringify(datesOf(jan.list)) === JSON.stringify(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']), JSON.stringify(datesOf(jan.list)))

  const tooWide = await req('GET', '/recurring/occurrences?from=2026-01-01&to=2027-06-01')
  assert('over-wide projection window -> 400', tooWide.status === 400, `status=${tooWide.status}`)
  const fakeDay = await req('GET', '/recurring/occurrences?from=2026-02-31&to=2026-03-31')
  assert('impossible date in projection -> 400', fakeDay.status === 400, `status=${fakeDay.status}`)
  const reversed = await req('GET', '/recurring/occurrences?from=2026-05-01&to=2026-04-01')
  assert('reversed projection -> 400', reversed.status === 400, `status=${reversed.status}`)

  // Partial PATCH: untouched columns keep their values.
  const patched = await req('PATCH', `/recurring/${ruleId}`, { body: { amount: 12.5 } })
  assert('partial PATCH ok', patched.status === 200, `status=${patched.status}`)
  assert('PATCH changed amount', near(patched.json?.amount, 12.5), `${patched.json?.amount}`)
  assert('PATCH kept note', patched.json?.note === 'Audit Sub', JSON.stringify(patched.json?.note))
  assert('PATCH kept anchor', patched.json?.billing_anchor_day === 31 && patched.json?.start_date === '2027-01-31', `${patched.json?.billing_anchor_day}/${patched.json?.start_date}`)
  assert('PATCH without schedule change kept next_date', patched.json?.next_date === '2027-01-31', `${patched.json?.next_date}`)
  const emptyPatch = await req('PATCH', `/recurring/${ruleId}`, { body: {} })
  assert('empty PATCH -> 400', emptyPatch.status === 400, `status=${emptyPatch.status}`)

  // Pay / undo cycle.
  const paidOnce = await req('POST', '/recurring/occurrences/pay', { body: { rule_id: ruleId, date: '2027-06-30' } })
  assert('pay scheduled occurrence -> 201', paidOnce.status === 201, `status=${paidOnce.status} body=${JSON.stringify(paidOnce.json).slice(0, 140)}`)
  assert('pay moved the balance', near(bal(await getAccounts(), ruleAcc), 1000 - 12.5), `${bal(await getAccounts(), ruleAcc)}`)
  const paidTwice = await req('POST', '/recurring/occurrences/pay', { body: { rule_id: ruleId, date: '2027-06-30' } })
  assert('repay same date -> 400 (no duplicate)', paidTwice.status === 400, `status=${paidTwice.status}`)
  const offSchedule = await req('POST', '/recurring/occurrences/pay', { body: { rule_id: ruleId, date: '2027-06-15' } })
  assert('pay a date the schedule does not have -> 400', offSchedule.status === 400, `status=${offSchedule.status}`)
  const paidSeen = await occs('2027-06-01', '2027-06-30')
  assert('projection marks the paid date', paidSeen.list.some(o => o.date === '2027-06-30' && o.paid === true), JSON.stringify(datesOf(paidSeen.list)))
  const undone = await req('DELETE', '/recurring/occurrences/pay', { body: { rule_id: ruleId, date: '2027-06-30' } })
  assert('undo pay -> 200', undone.status === 200, `status=${undone.status} body=${JSON.stringify(undone.json).slice(0, 140)}`)
  assert('undo restored the balance', near(bal(await getAccounts(), ruleAcc), 1000), `${bal(await getAccounts(), ruleAcc)}`)
  const paidGone = await occs('2027-06-01', '2027-06-30')
  assert('projection unmarked after undo', paidGone.list.every(o => o.paid === false), JSON.stringify(paidGone.list.map(o => o.paid)))
  const undoMissing = await req('DELETE', '/recurring/occurrences/pay', { body: { rule_id: ruleId, date: '2027-06-30' } })
  assert('undo of an unpaid date -> 400', undoMissing.status === 400, `status=${undoMissing.status}`)

  // Skip / unskip: exception only, the ledger stays untouched.
  const skipped = await req('POST', '/recurring/occurrences/skip', { body: { rule_id: ruleId, date: '2027-07-31' } })
  assert('skip scheduled occurrence -> 201', skipped.status === 201, `status=${skipped.status}`)
  assert('skip left the balance alone', near(bal(await getAccounts(), ruleAcc), 1000), `${bal(await getAccounts(), ruleAcc)}`)
  const skipSeen = await occs('2027-07-01', '2027-07-31')
  assert('projection marks the skipped date', skipSeen.list.some(o => o.date === '2027-07-31' && o.skipped === true), JSON.stringify(datesOf(skipSeen.list)))
  const skipOff = await req('POST', '/recurring/occurrences/skip', { body: { rule_id: ruleId, date: '2027-07-15' } })
  assert('skip off-schedule date -> 400', skipOff.status === 400, `status=${skipOff.status}`)
  const unskipped = await req('DELETE', '/recurring/occurrences/skip', { body: { rule_id: ruleId, date: '2027-07-31' } })
  assert('unskip -> 200', unskipped.status === 200 && unskipped.json?.deleted === true, JSON.stringify(unskipped.json))
  const skipGone = await occs('2027-07-01', '2027-07-31')
  assert('projection unmarked after unskip', skipGone.list.every(o => o.skipped === false), JSON.stringify(skipGone.list.map(o => o.skipped)))

  // run-now twice: the cursor advances, one transaction per date, no repeat.
  const run1 = await req('POST', `/recurring/${ruleId}/run-now`, { body: {} })
  assert('run-now creates the due occurrence', run1.status === 200 && run1.json?.created === true && run1.json?.occurrence === '2027-01-31', `status=${run1.status} body=${JSON.stringify(run1.json).slice(0, 140)}`)
  const run2 = await req('POST', `/recurring/${ruleId}/run-now`, { body: {} })
  assert('second run-now moves to the clamped next date', run2.status === 200 && run2.json?.occurrence === '2027-02-28', `body=${JSON.stringify(run2.json).slice(0, 140)}`)
  const run3 = await req('POST', `/recurring/${ruleId}/run-now`, { body: {} })
  assert('third run-now moves again, never repeats a date', run3.json?.occurrence === '2027-03-31', `body=${JSON.stringify(run3.json).slice(0, 140)}`)
  const runWindow = await occs('2027-01-01', '2027-03-31')
  const paidDates = runWindow.list.filter(o => o.paid).map(o => o.date)
  assert('exactly three paid occurrences, none duplicated', paidDates.length === 3 && new Set(paidDates).size === 3, JSON.stringify(paidDates))
  assert('run-now moved the balance three times', near(bal(await getAccounts(), ruleAcc), 1000 - 37.5), `${bal(await getAccounts(), ruleAcc)}`)
  const rulesList = await req('GET', '/recurring')
  const mine = (rulesList.json || []).find(r => r.id === ruleId)
  assert('list enriches with status/monthly equivalent', !!mine && mine.status === 'scheduled' && near(mine.monthly_equivalent, 12.5), JSON.stringify(mine && { status: mine.status, me: mine.monthly_equivalent }))
  assert('list counts paid occurrences', mine?.occurrences_paid === 3, `${mine?.occurrences_paid}`)
  assert('list reports the next occurrence after the ledger cursor', mine?.next_occurrence === '2027-04-30', `${mine?.next_occurrence}`)
  assert('list reports the owed occurrence for the row buttons', mine?.due_date === '2027-04-30', `${mine?.due_date}`)

  const history = await req('GET', `/recurring/${ruleId}/history`)
  const historyRows = Array.isArray(history.json) ? history.json : []
  if (!Array.isArray(history.json)) console.log(`  ...history diagnostic: status=${history.status} body=${String(history.text).slice(0, 300)}`)
  const kinds = historyRows.map(h => h.event_type)
  assert('history records created/price_changed/skipped/paid', history.status === 200 && ['created', 'price_changed', 'skipped', 'paid'].every(k => kinds.includes(k)), JSON.stringify(kinds))

  const expired = await req('POST', '/recurring', {
    body: { account_id: ruleAcc, amount: 5, type: 'expense', interval_unit: 'month', interval_value: 1, start_date: '2026-03-15', end_date: '2026-04-30', next_date: '2026-04-15', note: 'Expired Sub' }
  })
  const expiredId = expired.json?.id
  const afterCreate = await req('GET', '/recurring')
  const limited = (afterCreate.json || []).find(r => r.id === expiredId)
  assert('rule past end_date reports finished', !!limited && limited.status === 'finished', JSON.stringify(limited && { status: limited.status, next: limited.next_date }))

  // ---------- V: calendar feed ----------
  // The feed projects from the server's today, so this fixture is anchored to
  // the clock instead to a fixed year like the rest of section U.
  const soon = new Date(Date.now() + 3 * 86400000)
  const soonDate = soon.toISOString().slice(0, 10)
  const feedRule = await req('POST', '/recurring', {
    body: { account_id: ruleAcc, amount: 9.99, type: 'expense', interval_unit: 'month', interval_value: 1, start_date: soonDate, note: 'Feed Sub' }
  })
  const feedRuleId = feedRule.json?.id
  assert('feed fixture rule created', feedRule.status === 201 && !!feedRuleId, `status=${feedRule.status}`)

  const issued = await req('POST', '/recurring/feed-tokens', { body: { name: 'Blackbox calendar' } })
  const feedToken = issued.json?.token
  assert('feed token created and shown once', issued.status === 201 && typeof feedToken === 'string' && feedToken.length >= 16, `status=${issued.status}`)
  const feedList = await req('GET', '/recurring/feed-tokens')
  assert('feed token list never repeats the secret', feedList.status === 200 && !feedList.text.includes(feedToken) && !/"token(_hash)?"/.test(feedList.text), `status=${feedList.status} body=${String(feedList.text).slice(0, 200)}`)

  const feedRes = await fetch(`${BASE}/recurring.ics?token=${encodeURIComponent(feedToken)}`, { signal: AbortSignal.timeout(20000) })
  const feedBody = await feedRes.text()
  assert('feed -> 200 text/calendar', feedRes.status === 200 && String(feedRes.headers.get('content-type')).startsWith('text/calendar'), `status=${feedRes.status} type=${feedRes.headers.get('content-type')}`)
  assert('feed is a valid calendar envelope', feedBody.startsWith('BEGIN:VCALENDAR') && feedBody.includes('VERSION:2.0') && feedBody.trimEnd().endsWith('END:VCALENDAR'), feedBody.slice(0, 80).replace(/\r/g, '\\r'))
  const dtstart = `DTSTART;VALUE=DATE:${soonDate.replace(/-/g, '')}`
  assert('feed projects the upcoming occurrence as an all-day event', feedBody.includes(dtstart), `missing ${dtstart}`)
  assert('feed summarises the rule', feedBody.includes('SUMMARY:Feed Sub'), 'no SUMMARY for the rule note')
  assert('feed excludes the finished rule', !feedBody.includes('SUMMARY:Expired Sub'), 'a past-end-date rule leaked into the feed')
  const uidLine = (feedBody.match(/^UID:[^\r\n]*/m) || ['<no UID line>'])[0]
  assert('feed events carry a stable UID and no RRULE', /^UID:finapp-\d+-\d+-\d{4}-\d{2}-\d{2}@finapp$/.test(uidLine) && !feedBody.includes('RRULE'), `uid=${uidLine}`)
  assert('feed folds lines under 76 octets', feedBody.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75), 'a long unfolded line')

  const revoked = await req('DELETE', `/recurring/feed-tokens/${issued.json?.id}`)
  assert('feed token revoke -> 204', revoked.status === 204, `status=${revoked.status}`)
  const afterRevoke = await fetch(`${BASE}/recurring.ics?token=${encodeURIComponent(feedToken)}`, { signal: AbortSignal.timeout(20000) })
  assert('revoked token no longer serves the feed', afterRevoke.status === 401, `status=${afterRevoke.status}`)
  const junk = await fetch(`${BASE}/recurring.ics?token=0000000000aaaaaaaabbbbbbbb`, { signal: AbortSignal.timeout(20000) })
  assert('unknown token -> 401', junk.status === 401, `status=${junk.status}`)

  for (const id of [ruleId, expiredId, feedRuleId]) {
    const cleaned = await req('DELETE', `/recurring/${id}`)
    assert(`rule ${id} delete -> 204`, cleaned.status === 204, `status=${cleaned.status}`)
  }
  const afterDelete = await req('GET', `/recurring/${ruleId}/history`)
  assert('deleted rule history -> 404', afterDelete.status === 404, `status=${afterDelete.status}`)
  const goneFromList = await req('GET', '/recurring')
  assert('deleted rules leave the list', !(goneFromList.json || []).some(r => [ruleId, expiredId, feedRuleId].includes(r.id)), `${(goneFromList.json || []).length} rules left`)
}

console.log(results.join('\n'))
console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`)
process.exit(FAIL > 0 ? 1 : 0)
