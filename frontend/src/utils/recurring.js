const SINGLE_WORD = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }

// The API answers with the unit and step; the UI needs one sentence for both,
// with the bare adverb ("Monthly") reserved for a step of one.
export function scheduleLabel(t, rule) {
  const unit = rule?.interval_unit || 'month'
  const value = Number(rule?.interval_value) || 1
  if (value === 1) return t(`recurring.frequencies.${SINGLE_WORD[unit] || 'monthly'}`)
  return t(`recurring.interval.every.${unit}`, { count: value })
}

// Calendar clients accept nothing but a URL, so the feed credential is carried in
// the query string. The origin is a parameter because the app can be served from
// any host, including a path-prefixed one.
export function feedUrl(token, origin = window.location.origin) {
  return `${String(origin).replace(/\/+$/, '')}/api/v1/recurring.ics?token=${encodeURIComponent(token)}`
}
