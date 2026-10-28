import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

function dayOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('sv-SE')
}

export const useRecurringStore = defineStore('recurring', () => {
  const rules = ref([])
  const occurrences = ref([])
  const projectionWindow = ref(null)
  const loading = ref(false)
  const occurrencesLoading = ref(false)

  async function fetchRules() {
    loading.value = true
    try {
      rules.value = await api('/recurring')
    } finally {
      loading.value = false
    }
  }

  async function fetchOccurrences(from = dayOffset(-180), to = dayOffset(180)) {
    occurrencesLoading.value = true
    try {
      const res = await api(`/recurring/occurrences?from=${from}&to=${to}`)
      occurrences.value = res.occurrences
      projectionWindow.value = { from: res.from, to: res.to }
      return occurrences.value
    } finally {
      occurrencesLoading.value = false
    }
  }

  // Paying, skipping and generating all move the ledger cursor, so the rules
  // and whatever projection is already on screen have to be re-read.
  async function refresh() {
    await fetchRules()
    if (projectionWindow.value) await fetchOccurrences(projectionWindow.value.from, projectionWindow.value.to)
  }

  async function createRule(data) {
    await api('/recurring', { method: 'POST', body: JSON.stringify(data) })
    await refresh()
  }

  async function patchRule(id, patch) {
    await api(`/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    await refresh()
  }

  async function deleteRule(id) {
    await api(`/recurring/${id}`, { method: 'DELETE' })
    await refresh()
  }

  async function payOccurrence({ ruleId, date, amount, note }) {
    const body = { rule_id: ruleId, date }
    if (amount !== undefined && amount !== null) body.amount = amount
    if (note) body.note = note
    await api('/recurring/occurrences/pay', { method: 'POST', body: JSON.stringify(body) })
    await refresh()
  }

  async function unpayOccurrence({ ruleId, date }) {
    await api('/recurring/occurrences/pay', { method: 'DELETE', body: JSON.stringify({ rule_id: ruleId, date }) })
    await refresh()
  }

  async function skipOccurrence({ ruleId, date, note }) {
    const body = { rule_id: ruleId, date }
    if (note) body.note = note
    await api('/recurring/occurrences/skip', { method: 'POST', body: JSON.stringify(body) })
    await refresh()
  }

  async function unskipOccurrence({ ruleId, date }) {
    await api('/recurring/occurrences/skip', { method: 'DELETE', body: JSON.stringify({ rule_id: ruleId, date }) })
    await refresh()
  }

  async function runNow(id) {
    await api(`/recurring/${id}/run-now`, { method: 'POST', body: JSON.stringify({}) })
    await refresh()
  }

  async function fetchHistory(id) {
    return api(`/recurring/${id}/history`)
  }

  const feedTokens = ref([])

  // A feed token is shown once, at creation, and never comes back from the
  // server — the list only carries metadata.
  async function fetchFeedTokens() {
    feedTokens.value = await api('/recurring/feed-tokens')
  }

  async function createFeedToken(name) {
    const created = await api('/recurring/feed-tokens', { method: 'POST', body: JSON.stringify({ name }) })
    await fetchFeedTokens()
    return created
  }

  async function revokeFeedToken(id) {
    await api(`/recurring/feed-tokens/${id}`, { method: 'DELETE' })
    await fetchFeedTokens()
  }

  return {
    rules, occurrences, projectionWindow, loading, occurrencesLoading, feedTokens,
    fetchRules, fetchOccurrences, refresh,
    createRule, patchRule, deleteRule,
    payOccurrence, unpayOccurrence, skipOccurrence, unskipOccurrence,
    runNow, fetchHistory, fetchFeedTokens, createFeedToken, revokeFeedToken
  }
})
