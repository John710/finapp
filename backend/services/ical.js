import { shiftDays } from './recurring-schedule.js'

// RFC 5545 feed for external calendar clients. It takes the merged projection
// (subscriptions and debt installments, mergeOccurrences); every row needs
// date, amount, currency, user_id, name and optionally account_name.
// Occurrences are materialised as
// plain all-day VEVENTs instead of RRULEs: the schedule needs the anchor,
// payment-limit and skip-exception rules from recurring-schedule.js, which no
// calendar client can express, and a client that cannot see the exceptions would
// show payments the user already cancelled.

const CRLF = '\r\n'
const LINE_LIMIT = 75

// Every line break (CRLF, a lone CR or LF) becomes one escaped \n: a raw CR
// would end the content line early in clients that split on it.
function escapeText(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function utcStamp(iso) {
  return iso.slice(0, 19).replace(/[-:]/g, '') + 'Z'
}

function dayValue(dateStr) {
  return dateStr.replace(/-/g, '')
}

// Amounts arrive as numeric(24,12) strings. Trimming the padding keeps the exact
// stored value; parsing through a float would not.
function trimAmount(value) {
  const raw = String(value ?? '')
  if (!raw.includes('.')) return raw
  return raw.replace(/0+$/, '').replace(/\.$/, '')
}

function fold(nameAndValue) {
  const lines = []
  let prefix = ''
  let current = ''
  for (const char of nameAndValue) {
    if (Buffer.byteLength(prefix + current + char) > LINE_LIMIT) {
      lines.push(prefix + current)
      prefix = ' '
      current = char
    } else {
      current += char
    }
  }
  if (current) lines.push(prefix + current)
  return lines
}

// Debt installments get their own UID namespace: an installment id and a rule
// id may be equal, and a changed UID would duplicate the event in the client.
function eventUid(occurrence, uidHost) {
  const owner = occurrence.user_id ?? 0
  if (occurrence.kind === 'debt_installment') {
    return `finapp-debt-${owner}-${occurrence.installment_id}-${occurrence.date}@${uidHost}`
  }
  return `finapp-${owner}-${occurrence.rule_id}-${occurrence.date}@${uidHost}`
}

function eventLines(occurrence, uidHost, stamp) {
  const day = dayValue(occurrence.date)
  const amount = trimAmount(occurrence.amount)
  const summary = occurrence.name || `${amount} ${occurrence.currency || ''}`.trim()
  const lines = [
    'BEGIN:VEVENT',
    `UID:${eventUid(occurrence, uidHost)}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeText(summary)}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${dayValue(shiftDays(occurrence.date, 1))}`,
    `DESCRIPTION:${escapeText([amount, occurrence.currency, occurrence.account_name].filter(Boolean).join(' · '))}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT'
  ]
  if (occurrence.paid) lines.push(`X-FINAPP-PAID:${day}`)
  lines.push('END:VEVENT')
  return lines
}

export function buildFeed(occurrences, { calendarName = 'FinApp payments', uidHost = 'finapp', generatedAt } = {}) {
  const stamp = utcStamp(generatedAt ?? new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FinApp//Recurring//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(calendarName),
    'X-WR-TIMEZONE:UTC'
  ]
  for (const occurrence of occurrences) {
    if (!occurrence?.date || occurrence.skipped) continue
    lines.push(...eventLines(occurrence, uidHost, stamp))
  }
  lines.push('END:VCALENDAR')
  return lines.flatMap(fold).map(line => `${line}${CRLF}`).join('')
}
