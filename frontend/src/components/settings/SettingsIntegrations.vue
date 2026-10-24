<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800 mb-6">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.integrations_title') }}</h2>
    </div>

    <!-- CoinGecko -->
    <div class="p-5">
      <div class="flex items-center justify-between mb-2">
        <div>
          <p class="font-medium">{{ $t('settings.coingecko_key') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.coingecko_key_desc') }}</p>
        </div>
        <StatusBadge :dirty="isCoingeckoDirty" />
      </div>
      <div class="flex gap-2">
        <input v-model="coingeckoKey" type="text" placeholder="CG-..." class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <button v-if="isCoingeckoDirty" @click="saveCoingeckoKey" :disabled="savingKey || !coingeckoKey.trim()" class="px-4 py-2 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-semibold disabled:opacity-50">
          {{ savingKey ? $t('common.loading') : $t('common.save') }}
        </button>
        <button v-else-if="auth.user?.coingecko_api_key" @click="testCoingeckoKey" :disabled="coingeckoTestLoading" class="px-4 py-2 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-semibold disabled:opacity-50">
          {{ coingeckoTestLoading ? $t('common.loading') : $t('settings.coingecko_test') }}
        </button>
      </div>
    </div>

    <!-- Shoutrrr -->
    <div class="p-5">
      <div class="flex items-center justify-between mb-2">
        <div>
          <p class="font-medium">{{ $t('settings.shoutrrr_title') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.shoutrrr_desc') }}</p>
        </div>
        <StatusBadge :dirty="isShoutrrrDirty" />
      </div>
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('settings.shoutrrr_provider') }}</label>
          <select
            v-model="shoutrrrProvider"
            class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm"
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
            class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm disabled:opacity-50"
          />
          <p v-if="shoutrrrUrlError" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ shoutrrrUrlError }}</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-if="!auth.user?.shoutrrr_url || isShoutrrrDirty"
            @click="saveShoutrrrUrl"
            :disabled="shoutrrrLoading || shoutrrrTestLoading || !shoutrrrUrl.trim() || !!shoutrrrUrlError"
            class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {{ shoutrrrLoading ? $t('common.loading') : $t('settings.shoutrrr_save') }}
          </button>
          <template v-else>
            <button
              @click="sendTestShoutrrr"
              :disabled="shoutrrrLoading || shoutrrrTestLoading"
              class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {{ shoutrrrTestLoading ? $t('common.loading') : $t('settings.shoutrrr_test') }}
            </button>
            <button
              @click="disableShoutrrr"
              :disabled="shoutrrrLoading || shoutrrrTestLoading"
              class="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
            >
              {{ shoutrrrLoading ? $t('common.loading') : $t('settings.shoutrrr_disable') }}
            </button>
          </template>
          <a
            v-if="selectedShoutrrrProvider?.docsUrl"
            :href="selectedShoutrrrProvider.docsUrl"
            target="_blank"
            rel="noopener"
            class="text-sm text-primary-600 hover:underline"
          >
            {{ $t('settings.shoutrrr_docs') }}
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'
import { logger } from '@/utils/logger.js'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'
import StatusBadge from '../StatusBadge.vue'

const SHOUTRRR_PROVIDERS = [
  { key: 'telegram',   label: 'Telegram',          placeholder: 'telegram://bot-token@telegram?chats=@channel-1,chat-id-1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/telegram/' },
  { key: 'discord',    label: 'Discord',           placeholder: 'discord://token@id', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/discord/' },
  { key: 'gotify',     label: 'Gotify',            placeholder: 'gotify://gotify-host/token', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/gotify/' },
  { key: 'slack',      label: 'Slack',             placeholder: 'slack://token-a/token-b/token-c', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/slack/' },
  { key: 'matrix',     label: 'Matrix',            placeholder: 'matrix://username:password@host:port/?rooms=!roomID1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/matrix/' },
  { key: 'ntfy',       label: 'Ntfy',              placeholder: 'ntfy://username:password@ntfy.sh/topic', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/ntfy/' },
  { key: 'pushover',   label: 'Pushover',          placeholder: 'pushover://shoutrrr:apiToken@userKey/?devices=device1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/pushover/' },
  { key: 'pushbullet', label: 'Pushbullet',        placeholder: 'pushbullet://api-token/device/#channel/email', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/pushbullet/' },
  { key: 'bark',       label: 'Bark',              placeholder: 'bark://devicekey@host', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/bark/' },
  { key: 'email',      label: 'Email (SMTP)',      placeholder: 'smtp://username:password@host:port/?from=fromAddress&to=recipient1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/smtp/' },
  { key: 'googlechat', label: 'Google Chat',       placeholder: 'googlechat://chat.googleapis.com/v1/spaces/FOO/messages?key=bar&token=baz', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/googlechat/' },
  { key: 'mattermost', label: 'Mattermost',        placeholder: 'mattermost://username@mattermost-host/token/channel', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/mattermost/' },
  { key: 'rocketchat', label: 'Rocket.Chat',       placeholder: 'rocketchat://username@rocketchat-host/token/channel', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/rocketchat/' },
  { key: 'teams',      label: 'Microsoft Teams',   placeholder: 'teams://group@tenant/altId/groupOwner?host=organization.webhook.office.com', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/teams/' },
  { key: 'zulip',      label: 'Zulip',             placeholder: 'zulip://bot-mail:bot-key@zulip-domain/?stream=name-or-id&topic=name', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/zulip/' },
  { key: 'ifttt',      label: 'IFTTT',             placeholder: 'ifttt://key/?events=event1&value1=value1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/ifttt/' },
  { key: 'join',       label: 'Join',              placeholder: 'join://shoutrrr:api-key@join/?devices=device1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/join/' },
  { key: 'opsgenie',   label: 'OpsGenie',          placeholder: 'opsgenie://host/token?responders=responder1', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/opsgenie/' },
  { key: 'generic',    label: 'Generic Webhook',   placeholder: 'generic://example.com?template=json', docsUrl: 'https://containrrr.dev/shoutrrr/v0.8/services/generic/' },
  { key: 'custom',     label: 'Custom HTTP(S)',    placeholder: 'https://example.com/webhook', docsUrl: '' }
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

function normalizeShoutrrrUrl(url) {
  // Remove accidental http(s) scheme inside non-http Shoutrrr URLs, e.g. gotify://https://host/token
  return url.replace(/^([a-z][a-z0-9+.-]*):\/\/(https?:\/\/)/i, '$1://')
}

const { t } = useI18n()
const auth = useAuthStore()
const settingsStore = useSettingsStore()

const coingeckoKey = ref('')
const savingKey = ref(false)
const coingeckoTestLoading = ref(false)

const shoutrrrUrl = ref('')
const shoutrrrProvider = ref('')
const shoutrrrLoading = ref(false)
const shoutrrrTestLoading = ref(false)

const isCoingeckoDirty = computed(() => {
  const saved = auth.user?.coingecko_api_key || ''
  return coingeckoKey.value.trim() !== saved
})

const isShoutrrrDirty = computed(() => {
  const saved = auth.user?.shoutrrr_url || ''
  return shoutrrrUrl.value.trim() !== saved
})

const selectedShoutrrrProvider = computed(() => SHOUTRRR_PROVIDERS.find(p => p.key === shoutrrrProvider.value))
const shoutrrrPlaceholder = computed(() => selectedShoutrrrProvider.value?.placeholder || 'telegram://bot-token@telegram?chats=@channel-1')

const shoutrrrUrlError = computed(() => {
  const url = shoutrrrUrl.value.trim()
  if (!url) return ''
  const normalized = normalizeShoutrrrUrl(url)
  const lower = normalized.toLowerCase()
  const provider = shoutrrrProvider.value
  if (!provider) return t('settings.shoutrrr_provider_required')
  if (provider === 'custom') {
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
      return t('settings.shoutrrr_url_invalid')
    }
  } else if (!lower.startsWith(`${provider}://`) && !lower.startsWith(`${provider}+`)) {
    return t('settings.shoutrrr_url_invalid_provider', { provider: selectedShoutrrrProvider.value?.label || provider })
  }
  return ''
})

onMounted(() => {
  if (auth.user?.coingecko_api_key) {
    coingeckoKey.value = auth.user.coingecko_api_key
  }
  if (auth.user?.shoutrrr_url) {
    shoutrrrUrl.value = auth.user.shoutrrr_url
    shoutrrrProvider.value = detectProvider(auth.user.shoutrrr_url)
  }
})

async function saveCoingeckoKey() {
  const key = coingeckoKey.value.trim()
  savingKey.value = true
  try {
    await auth.updateSettings({ coingecko_api_key: key || null })
    window.$toast?.success(t('common.saved'))
  } catch (e) {
    logger.error('Failed to save API key', e)
    window.$toast?.error(t('common.error'))
  } finally {
    savingKey.value = false
  }
}

async function testCoingeckoKey() {
  const key = coingeckoKey.value.trim()
  if (!key) return
  coingeckoTestLoading.value = true
  try {
    await settingsStore.testCoingeckoKey(key)
    window.$toast?.success(t('settings.coingecko_test_success'))
  } catch (e) {
    logger.error('CoinGecko key test failed', e)
    window.$toast?.error(e.message || t('settings.coingecko_test_failed'))
  } finally {
    coingeckoTestLoading.value = false
  }
}

async function saveShoutrrrUrl() {
  let url = shoutrrrUrl.value.trim()
  if (!url) return
  url = normalizeShoutrrrUrl(url)
  shoutrrrUrl.value = url
  if (shoutrrrUrlError.value) return
  shoutrrrLoading.value = true
  try {
    await settingsStore.saveShoutrrrUrl(url)
    await auth.fetchMe()
    window.$toast?.success(t('settings.shoutrrr_saved_success'))
  } catch (e) {
    logger.error('Failed to save Shoutrrr URL', e)
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
    await auth.fetchMe()
    shoutrrrUrl.value = ''
    shoutrrrProvider.value = ''
    window.$toast?.success(t('settings.shoutrrr_disabled_success'))
  } catch (e) {
    logger.error('Failed to disable Shoutrrr', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    shoutrrrLoading.value = false
  }
}

async function sendTestShoutrrr() {
  shoutrrrTestLoading.value = true
  try {
    await api('/send-test-shoutrrr', { method: 'POST', body: JSON.stringify({}) })
    window.$toast?.success(t('notifications.test_shoutrrr_sent'))
  } catch (e) {
    logger.error('Test shoutrrr failed', e)
    window.$toast?.error(e.message || t('notifications.test_shoutrrr_failed'))
  } finally {
    shoutrrrTestLoading.value = false
  }
}
</script>
