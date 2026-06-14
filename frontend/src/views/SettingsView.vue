<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">{{ $t('settings.title') }}</h1>
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
      <div class="p-5 flex items-center justify-between">
        <div>
          <p class="font-medium">{{ $t('settings.theme') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.theme_desc') }}</p>
        </div>
        <select v-model="theme" @change="changeTheme" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm">
          <option value="auto">{{ $t('settings.theme_auto') }}</option>
          <option value="light">{{ $t('settings.theme_light') }}</option>
          <option value="dark">{{ $t('settings.theme_dark') }}</option>
        </select>
      </div>
      <div class="p-5 flex items-center justify-between">
        <div>
          <p class="font-medium">{{ $t('settings.language') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.language_desc') }}</p>
        </div>
        <select v-model="locale" @change="changeLang" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm">
          <option value="ru">{{ $t('settings.lang_ru') }}</option>
          <option value="en">{{ $t('settings.lang_en') }}</option>
        </select>
      </div>
      <div class="p-5 flex items-center justify-between">
        <div>
          <p class="font-medium">{{ $t('settings.base_currency') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.base_currency_desc') }}</p>
        </div>
        <div class="relative w-48" ref="selectRef">
          <button type="button" @click="showDropdown = !showDropdown" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left text-sm flex items-center justify-between">
            <span>{{ selectedCurrency?.code }} ({{ selectedCurrency?.symbol || selectedCurrency?.code }})</span>
            <Icon name="arrowDown" class="w-4 h-4 text-slate-400" />
          </button>
          <div v-if="showDropdown" class="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg max-h-60 overflow-hidden flex flex-col">
            <div class="p-2 border-b border-slate-100 dark:border-slate-800">
              <input v-model="search" type="text" :placeholder="$t('common.search')" ref="searchInput" class="w-full px-2 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" @keydown="onKeydown" />
            </div>
            <div class="overflow-y-auto flex-1">
              <button v-for="fc in filteredCurrencies" :key="fc.code" type="button" @click="selectCurrency(fc)"
                class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between transition-colors"
                :class="baseCurrency === fc.code ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600' : ''">
                <span class="font-medium">{{ fc.code }}</span>
                <span class="text-slate-500 text-xs">{{ fc.name }}</span>
              </button>
              <div v-if="filteredCurrencies.length === 0" class="px-3 py-4 text-sm text-slate-500 text-center">{{ $t('common.empty') }}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="p-5">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="font-medium">{{ $t('settings.coingecko_key') }}</p>
            <p class="text-sm text-slate-500">{{ $t('settings.coingecko_key_desc') }}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <input v-model="coingeckoKey" type="text" placeholder="CG-..." class="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
          <button @click="saveCoingeckoKey" :disabled="savingKey" class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {{ savingKey ? '...' : $t('common.save') }}
          </button>
        </div>
      </div>

      <!-- VAPID / Push keys -->
      <div class="p-5">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="font-medium">{{ $t('settings.vapid_title') }}</p>
            <p class="text-sm text-slate-500">{{ $t('settings.vapid_desc') }}</p>
          </div>
        </div>
        <div class="space-y-3">
          <div v-if="auth.user?.vapid_public_key" class="text-sm text-emerald-600 dark:text-emerald-400">
            {{ $t('settings.vapid_configured_for', { email: vapidSubjectEmail || '-' }) }}
          </div>
          <div v-else class="text-sm text-amber-600 dark:text-amber-400">
            {{ $t('settings.vapid_not_configured') }}
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('settings.vapid_email') }}</label>
            <p class="text-xs text-slate-500 mb-1">{{ $t('settings.vapid_email_desc') }}</p>
            <input
              v-model="vapidEmail"
              type="email"
              :placeholder="$t('settings.vapid_email')"
              :disabled="vapidLoading || vapidDeleteLoading"
              class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm disabled:opacity-50"
            />
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="generateVapidKeys"
              :disabled="vapidLoading || vapidDeleteLoading || !vapidEmail"
              class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {{ vapidLoading ? '...' : (auth.user?.vapid_public_key ? $t('settings.vapid_regenerate') : $t('settings.vapid_generate')) }}
            </button>
            <button
              v-if="auth.user?.vapid_public_key"
              @click="deleteVapidKeys"
              :disabled="vapidLoading || vapidDeleteLoading"
              class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {{ vapidDeleteLoading ? '...' : $t('settings.vapid_delete') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Push subscription -->
      <div class="p-5 flex items-center justify-between">
        <div>
          <p class="font-medium">{{ $t('settings.push_notifications') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.push_desc') }}</p>
        </div>
        <div v-if="!push.isSupported" class="text-sm text-slate-400">{{ $t('settings.push_unsupported') }}</div>
        <div v-else-if="push.subscription.value" class="flex items-center gap-2">
          <button
            @click="sendTestPush()"
            :disabled="testLoading"
            class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {{ testLoading ? '...' : $t('settings.push_test') }}
          </button>
          <button
            @click="push.unsubscribe()"
            :disabled="push.loading.value"
            class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {{ push.loading.value ? '...' : $t('settings.push_unsubscribe') }}
          </button>
        </div>
        <div v-else-if="!push.serverConfigured.value" class="text-sm text-amber-600 dark:text-amber-400">{{ $t('settings.push_not_configured') }}</div>
        <button
          v-else
          @click="push.subscribe()"
          :disabled="push.loading.value"
          class="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
        >
          {{ push.loading.value ? '...' : $t('settings.push_subscribe') }}
        </button>
      </div>

      <!-- Shoutrrr -->
      <div class="p-5">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="font-medium">{{ $t('settings.shoutrrr_title') }}</p>
            <p class="text-sm text-slate-500">{{ $t('settings.shoutrrr_desc') }}</p>
          </div>
        </div>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('settings.shoutrrr_provider') }}</label>
            <select
              v-model="shoutrrrProvider"
              class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
            >
              <option value="">{{ $t('settings.shoutrrr_provider_placeholder') }}</option>
              <option v-for="p in SHOUTRRR_PROVIDERS" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('settings.shoutrrr_url') }}</label>
            <input
              v-model="shoutrrrUrl"
              type="text"
              :placeholder="shoutrrrPlaceholder"
              :disabled="shoutrrrLoading || shoutrrrTestLoading"
              class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm disabled:opacity-50"
            />
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="!auth.user?.shoutrrr_url || isShoutrrrDirty"
              @click="saveShoutrrrUrl"
              :disabled="shoutrrrLoading || shoutrrrTestLoading || !shoutrrrUrl.trim()"
              class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {{ shoutrrrLoading ? '...' : $t('settings.shoutrrr_save') }}
            </button>
            <template v-else>
              <button
                @click="sendTestShoutrrr"
                :disabled="shoutrrrLoading || shoutrrrTestLoading"
                class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {{ shoutrrrTestLoading ? '...' : $t('settings.shoutrrr_test') }}
              </button>
              <button
                @click="disableShoutrrr"
                :disabled="shoutrrrLoading || shoutrrrTestLoading"
                class="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
              >
                {{ shoutrrrLoading ? '...' : $t('settings.shoutrrr_disable') }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <div class="p-5 flex items-center justify-between">
        <div>
          <p class="font-medium">{{ $t('settings.load_demo') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.load_demo_desc') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="loadDemoData()"
            :disabled="demoLoading"
            class="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {{ demoLoading ? '...' : $t('settings.load') }}
          </button>
        </div>
      </div>
      <div class="p-5 flex items-center justify-between">
        <div>
          <p class="font-medium text-red-600">{{ $t('settings.clear_db') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.clear_db_desc') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="clearDatabase()"
            :disabled="clearLoading"
            class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {{ clearLoading ? '...' : $t('settings.clear') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePush } from '@/composables/usePush.js'
import { api } from '@/utils/api.js'
import { useAuthStore } from '../stores/auth'
import { useRatesStore } from '../stores/rates'
import { useSettingsStore } from '../stores/settings'

const SHOUTRRR_PROVIDERS = [
  { key: 'telegram',   label: 'Telegram',          placeholder: 'telegram://bot-token@telegram?chats=@channel-1,chat-id-1' },
  { key: 'discord',    label: 'Discord',           placeholder: 'discord://token@id' },
  { key: 'gotify',     label: 'Gotify',            placeholder: 'gotify://gotify-host/token' },
  { key: 'slack',      label: 'Slack',             placeholder: 'slack://token-a/token-b/token-c' },
  { key: 'matrix',     label: 'Matrix',            placeholder: 'matrix://username:password@host:port/?rooms=!roomID1' },
  { key: 'ntfy',       label: 'Ntfy',              placeholder: 'ntfy://username:password@ntfy.sh/topic' },
  { key: 'pushover',   label: 'Pushover',          placeholder: 'pushover://shoutrrr:apiToken@userKey/?devices=device1' },
  { key: 'pushbullet', label: 'Pushbullet',        placeholder: 'pushbullet://api-token/device/#channel/email' },
  { key: 'bark',       label: 'Bark',              placeholder: 'bark://devicekey@host' },
  { key: 'email',      label: 'Email (SMTP)',      placeholder: 'smtp://username:password@host:port/?from=fromAddress&to=recipient1' },
  { key: 'googlechat', label: 'Google Chat',       placeholder: 'googlechat://chat.googleapis.com/v1/spaces/FOO/messages?key=bar&token=baz' },
  { key: 'mattermost', label: 'Mattermost',        placeholder: 'mattermost://username@mattermost-host/token/channel' },
  { key: 'rocketchat', label: 'Rocket.Chat',       placeholder: 'rocketchat://username@rocketchat-host/token/channel' },
  { key: 'teams',      label: 'Microsoft Teams',   placeholder: 'teams://group@tenant/altId/groupOwner?host=organization.webhook.office.com' },
  { key: 'zulip',      label: 'Zulip',             placeholder: 'zulip://bot-mail:bot-key@zulip-domain/?stream=name-or-id&topic=name' },
  { key: 'ifttt',      label: 'IFTTT',             placeholder: 'ifttt://key/?events=event1&value1=value1' },
  { key: 'join',       label: 'Join',              placeholder: 'join://shoutrrr:api-key@join/?devices=device1' },
  { key: 'opsgenie',   label: 'OpsGenie',          placeholder: 'opsgenie://host/token?responders=responder1' },
  { key: 'generic',    label: 'Generic Webhook',   placeholder: 'generic://example.com?template=json' },
  { key: 'custom',     label: 'Custom HTTP(S)',    placeholder: 'https://example.com/webhook' }
]

function detectProvider(url) {
  if (!url) return ''
  const lower = url.toLowerCase()
  for (const p of SHOUTRRR_PROVIDERS) {
    if (p.key === 'custom') {
      if (lower.startsWith('http://') || lower.startsWith('https://')) return p.key
      continue
    }
    if (lower.startsWith(`${p.key}://`) || lower.startsWith(`${p.key}+`)) return p.key
  }
  return ''
}

const { locale, t } = useI18n()
const auth = useAuthStore()
const settingsStore = useSettingsStore()
const ratesStore = useRatesStore()
const theme = ref(localStorage.getItem('theme') || 'auto')
const baseCurrency = ref(localStorage.getItem('base_currency') || 'USD')
const coingeckoKey = ref('')
const savingKey = ref(false)
const push = usePush()
const testLoading = ref(false)
const demoLoading = ref(false)
const clearLoading = ref(false)

const vapidEmail = ref('')
const vapidLoading = ref(false)
const vapidDeleteLoading = ref(false)

const shoutrrrUrl = ref('')
const shoutrrrProvider = ref('')
const shoutrrrLoading = ref(false)
const shoutrrrTestLoading = ref(false)

const isShoutrrrDirty = computed(() => {
  const saved = auth.user?.shoutrrr_url || ''
  return shoutrrrUrl.value.trim() !== saved
})

const vapidSubjectEmail = computed(() => auth.user?.vapid_subject?.replace(/^mailto:/i, '') || '')
const shoutrrrPlaceholder = computed(() => {
  const p = SHOUTRRR_PROVIDERS.find(p => p.key === shoutrrrProvider.value)
  return p?.placeholder || 'telegram://bot-token@telegram?chats=@channel-1'
})

const showDropdown = ref(false)
const search = ref('')
const selectRef = ref(null)
const searchInput = ref(null)

const selectedCurrency = computed(() =>
  ratesStore.fiatCurrencies.find(fc => fc.code === baseCurrency.value) || { code: baseCurrency.value, symbol: baseCurrency.value, name: '' }
)

const filteredCurrencies = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return ratesStore.fiatCurrencies
  return ratesStore.fiatCurrencies.filter(fc =>
    fc.code.toLowerCase().includes(q) ||
    fc.name.toLowerCase().includes(q) ||
    (fc.symbol && fc.symbol.toLowerCase().includes(q))
  )
})

onMounted(async () => {
  push.getSubscription()
  ratesStore.fetchRates()
  document.addEventListener('click', onDocClick)
  if (auth.user?.coingecko_api_key) {
    coingeckoKey.value = auth.user.coingecko_api_key
  } else if (auth.isAuthenticated) {
    await auth.fetchMe()
    if (auth.user?.coingecko_api_key) coingeckoKey.value = auth.user.coingecko_api_key
    if (auth.user?.base_currency) baseCurrency.value = auth.user.base_currency
  }

  if (auth.user?.vapid_subject) {
    vapidEmail.value = auth.user.vapid_subject.replace(/^mailto:/i, '')
  }
  if (auth.user?.shoutrrr_url) {
    shoutrrrUrl.value = auth.user.shoutrrr_url
    shoutrrrProvider.value = detectProvider(auth.user.shoutrrr_url)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

function onDocClick(e) {
  if (showDropdown.value && selectRef.value && !selectRef.value.contains(e.target)) {
    showDropdown.value = false
  }
}

async function selectCurrency(fc) {
  baseCurrency.value = fc.code
  showDropdown.value = false
  search.value = ''
  await changeBaseCurrency()
}

watch(showDropdown, async (val) => {
  if (val) {
    search.value = ''
    await nextTick()
    searchInput.value?.focus()
  }
})

function onKeydown(e) {
  if (e.key === 'Escape') showDropdown.value = false
}

function changeTheme() {
  localStorage.setItem('theme', theme.value)
  const root = document.documentElement
  if (theme.value === 'dark') {
    root.classList.add('dark')
  } else if (theme.value === 'light') {
    root.classList.remove('dark')
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }
  window.$toast?.success(t('common.saved'))
}

async function changeLang() {
  localStorage.setItem('lang', locale.value)
  if (auth.isAuthenticated) {
    try {
      await auth.updateLanguage(locale.value)
      window.$toast?.success(t('common.saved'))
    } catch (e) {
      console.error('Failed to sync language', e)
      window.$toast?.error(t('common.error'))
    }
  } else {
    window.$toast?.success(t('common.saved'))
  }
}

async function changeBaseCurrency() {
  ratesStore.setBaseCurrency(baseCurrency.value)
  if (auth.isAuthenticated) {
    try {
      await auth.updateSettings({ base_currency: baseCurrency.value })
      window.$toast?.success(t('common.saved'))
    } catch (e) {
      console.error('Failed to sync base currency', e)
      window.$toast?.error(t('common.error'))
    }
  } else {
    window.$toast?.success(t('common.saved'))
  }
}

async function saveCoingeckoKey() {
  savingKey.value = true
  try {
    await auth.updateSettings({ coingecko_api_key: coingeckoKey.value.trim() || null })
    window.$toast?.success(t('common.saved'))
  } catch (e) {
    console.error('Failed to save API key', e)
    window.$toast?.error(t('common.error'))
  } finally {
    savingKey.value = false
  }
}

async function generateVapidKeys() {
  const email = vapidEmail.value.trim()
  if (!email) return
  const confirmed = await window.$confirm({
    title: auth.user?.vapid_public_key ? t('settings.vapid_regenerate') : t('settings.vapid_generate'),
    message: t('settings.vapid_generate_confirm'),
    confirmText: auth.user?.vapid_public_key ? t('settings.vapid_regenerate') : t('settings.vapid_generate'),
    cancelText: t('common.cancel')
  })
  if (!confirmed) return
  vapidLoading.value = true
  try {
    const data = await settingsStore.generateVapidKeys(email)
    auth.user.vapid_public_key = data.publicKey
    auth.user.vapid_subject = data.subject
    vapidEmail.value = data.subject.replace(/^mailto:/i, '')
    if (push.subscription.value) {
      await push.unsubscribe()
    } else {
      push.getSubscription()
    }
    window.$toast?.success(t('settings.vapid_generated_success'))
  } catch (e) {
    console.error('Failed to generate VAPID keys', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    vapidLoading.value = false
  }
}

async function deleteVapidKeys() {
  const confirmed = await window.$confirm({
    title: t('settings.vapid_delete'),
    message: t('settings.vapid_delete_confirm'),
    confirmText: t('settings.vapid_delete'),
    cancelText: t('common.cancel'),
    danger: true
  })
  if (!confirmed) return
  vapidDeleteLoading.value = true
  try {
    await settingsStore.deleteVapidKeys()
    auth.user.vapid_public_key = null
    auth.user.vapid_subject = null
    vapidEmail.value = ''
    if (push.subscription.value) {
      await push.unsubscribe()
    } else {
      push.getSubscription()
    }
    window.$toast?.success(t('settings.vapid_deleted_success'))
  } catch (e) {
    console.error('Failed to delete VAPID keys', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    vapidDeleteLoading.value = false
  }
}

async function sendTestPush() {
  testLoading.value = true
  try {
    const data = await api('/send-test', { method: 'POST' })
    window.$toast?.success(`${t('notifications.test_push_sent')}: ${data.sent} / ${data.failed}`)
  } catch (e) {
    console.error('Test push failed', e)
    window.$toast?.error(e.message || t('notifications.test_push_failed'))
  } finally {
    testLoading.value = false
  }
}

async function saveShoutrrrUrl() {
  const url = shoutrrrUrl.value.trim()
  if (!url) return
  shoutrrrLoading.value = true
  try {
    await settingsStore.saveShoutrrrUrl(url)
    auth.user.shoutrrr_url = url
    window.$toast?.success(t('settings.shoutrrr_saved_success'))
  } catch (e) {
    console.error('Failed to save Shoutrrr URL', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    shoutrrrLoading.value = false
  }
}

async function disableShoutrrr() {
  const confirmed = await window.$confirm({
    title: t('settings.shoutrrr_disable'),
    message: t('settings.shoutrrr_disable_confirm'),
    confirmText: t('settings.shoutrrr_disable'),
    cancelText: t('common.cancel'),
    danger: true
  })
  if (!confirmed) return
  shoutrrrLoading.value = true
  try {
    await settingsStore.saveShoutrrrUrl(null)
    auth.user.shoutrrr_url = null
    shoutrrrUrl.value = ''
    shoutrrrProvider.value = ''
    window.$toast?.success(t('settings.shoutrrr_disabled_success'))
  } catch (e) {
    console.error('Failed to disable Shoutrrr', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    shoutrrrLoading.value = false
  }
}

async function sendTestShoutrrr() {
  shoutrrrTestLoading.value = true
  try {
    await api('/send-test-shoutrrr', { method: 'POST' })
    window.$toast?.success(t('notifications.test_shoutrrr_sent'))
  } catch (e) {
    console.error('Test shoutrrr failed', e)
    window.$toast?.error(e.message || t('notifications.test_shoutrrr_failed'))
  } finally {
    shoutrrrTestLoading.value = false
  }
}

async function loadDemoData() {
  const confirmed = await window.$confirm({
    title: t('settings.load_demo'),
    message: t('settings.load_demo_confirm'),
    confirmText: t('settings.load'),
    cancelText: t('common.cancel')
  })
  if (!confirmed) return
  demoLoading.value = true
  try {
    await api('/admin/load-demo', { method: 'POST' })
    window.$toast?.success(t('settings.load_demo_success'))
    setTimeout(() => window.location.reload(), 1500)
  } catch (e) {
    console.error('Load demo data failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    demoLoading.value = false
  }
}

async function clearDatabase() {
  const confirmed = await window.$confirm({
    title: t('settings.clear_db'),
    message: t('settings.clear_db_confirm'),
    confirmText: t('settings.clear'),
    cancelText: t('common.cancel'),
    danger: true
  })
  if (!confirmed) return
  clearLoading.value = true
  try {
    await api('/admin/clear-database', { method: 'POST' })
    window.$toast?.success(t('settings.clear_db_success'))
    setTimeout(() => window.location.reload(), 1500)
  } catch (e) {
    console.error('Clear database failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    clearLoading.value = false
  }
}
</script>
