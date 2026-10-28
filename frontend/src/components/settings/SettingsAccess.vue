<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800 mb-6">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.access_title') }}</h2>
    </div>

    <!-- Family sharing how-to -->
    <div class="p-5">
      <p class="font-medium">{{ $t('settings.sharing_title') }}</p>
      <p class="text-sm text-slate-500">{{ $t('settings.sharing_desc') }}</p>
    </div>

    <!-- Two-factor authentication -->
    <div class="p-5">
      <div class="mb-3">
        <p class="font-medium">{{ $t('settings.totp_title') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.totp_desc') }}</p>
      </div>
      <div v-if="totpEnabled" class="text-sm text-emerald-600 dark:text-emerald-400 mb-3">{{ $t('settings.totp_enabled') }}</div>
      <div v-else class="text-sm text-slate-500 mb-3">{{ $t('settings.totp_disabled') }}</div>

      <div v-if="!totpEnabled && setupStage === 'idle'" class="space-y-2 max-w-sm">
        <input v-model="totpPassword" type="password" autocomplete="current-password" :placeholder="$t('settings.password_current')" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <button @click="startTotpSetup" :disabled="totpLoading || !totpPassword" class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {{ totpLoading ? $t('common.loading') : $t('settings.totp_setup') }}
        </button>
      </div>
      <div v-else-if="!totpEnabled && setupStage === 'confirm'" class="space-y-3">
        <div class="flex flex-col items-center gap-3">
          <img v-if="totpQr" :src="totpQr" alt="TOTP QR" class="w-44 h-44 rounded-2xl bg-white p-2" />
          <p class="text-xs text-slate-500 break-all text-center">{{ totpSecret }}</p>
        </div>
        <div class="flex gap-2 max-w-xs mx-auto">
          <input v-model="totpCode" type="text" inputmode="numeric" maxlength="8" :placeholder="$t('auth.totp_code')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm tracking-widest" />
          <button @click="enableTotp" :disabled="totpLoading || !totpCode" class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {{ totpLoading ? $t('common.loading') : $t('settings.totp_enable') }}
          </button>
        </div>
      </div>
      <div v-else class="space-y-2 max-w-sm">
        <div class="flex gap-2">
          <input v-model="totpPassword" type="password" autocomplete="current-password" :placeholder="$t('settings.password_current')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
          <input v-model="totpCode" type="text" inputmode="numeric" maxlength="8" :placeholder="$t('auth.totp_code')" class="w-28 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm tracking-widest" />
        </div>
        <button @click="disableTotp" :disabled="totpLoading || !totpPassword || !totpCode" class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
          {{ totpLoading ? $t('common.loading') : $t('settings.totp_disable') }}
        </button>
      </div>
    </div>

    <!-- API tokens -->
    <div class="p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <p class="font-medium">{{ $t('settings.tokens_title') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.tokens_desc') }}</p>
        </div>
      </div>
      <div v-if="newToken" class="mb-3 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border-0">
        <p class="text-xs text-emerald-700 dark:text-emerald-300 mb-1">{{ $t('settings.token_created_once') }}</p>
        <code class="text-xs break-all">{{ newToken }}</code>
      </div>
      <ul v-if="tokens.length" class="space-y-2 mb-3">
        <li v-for="tok in tokens" :key="tok.id" class="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div class="text-sm min-w-0">
            <span class="font-medium truncate block">{{ tok.name }}</span>
            <p class="text-xs text-slate-500">{{ $t('settings.token_last_used') }}: {{ tok.last_used_at ? formatDateTime(tok.last_used_at) : '—' }}</p>
          </div>
          <button @click="revokeToken(tok.id)" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600">
            {{ $t('common.delete') }}
          </button>
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500 mb-3">{{ $t('settings.tokens_empty') }}</p>
      <div class="flex gap-2 max-w-sm">
        <input v-model="newTokenName" type="text" :placeholder="$t('settings.token_name')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <button @click="createToken" :disabled="tokenLoading || !newTokenName.trim()" class="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {{ tokenLoading ? $t('common.loading') : $t('common.add') }}
        </button>
      </div>
    </div>

    <!-- Calendar feed (iCal) -->
    <div class="p-5">
      <div class="mb-3">
        <p class="font-medium">{{ $t('settings.feed_title') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.feed_desc') }}</p>
      </div>
      <div v-if="feedLink" class="mb-3 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border-0">
        <p class="text-xs text-emerald-700 dark:text-emerald-300 mb-1">{{ $t('settings.feed_created_once') }}</p>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ feedLink }}</code>
          <button @click="copyFeedLink" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0">
            {{ $t('settings.feed_copy') }}
          </button>
        </div>
      </div>
      <ul v-if="recurring.feedTokens.length" class="space-y-2 mb-3">
        <li v-for="feed in recurring.feedTokens" :key="feed.id" class="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div class="text-sm min-w-0">
            <span class="font-medium truncate block">{{ feed.name }}</span>
            <span v-if="feed.revoked_at" class="text-xs text-red-500">{{ $t('settings.feed_revoked') }}</span>
            <span v-else class="text-xs text-slate-500">{{ $t('settings.feed_last_used') }}: {{ feed.last_used_at ? formatDateTime(feed.last_used_at) : '—' }}</span>
          </div>
          <button v-if="!feed.revoked_at" @click="revokeFeed(feed.id)" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600">
            {{ $t('common.delete') }}
          </button>
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500 mb-3">{{ $t('settings.feed_empty') }}</p>
      <div class="flex gap-2 max-w-sm">
        <input v-model="newFeedName" type="text" :placeholder="$t('settings.feed_name')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <button @click="createFeed" :disabled="feedLoading || !newFeedName.trim()" class="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {{ feedLoading ? $t('common.loading') : $t('common.add') }}
        </button>
      </div>
    </div>

    <!-- User management (admin only) -->
    <div v-if="isAdmin" class="p-5">
      <div class="mb-3">
        <p class="font-medium">{{ $t('settings.users_title') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.users_desc') }}</p>
      </div>
      <ul v-if="users.length" class="space-y-2 mb-3">
        <li v-for="u in users" :key="u.id" class="flex items-center justify-between gap-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div class="text-sm min-w-0">
            <span class="font-medium">{{ u.login }}</span>
            <span v-if="u.role === 'admin'" class="ml-2 text-xs px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">{{ $t('settings.users_admin_badge') }}</span>
            <span v-if="u.id === auth.user?.id" class="ml-2 text-xs text-slate-400">({{ $t('settings.users_you') }})</span>
            <p class="text-xs text-slate-500">{{ $t('settings.users_created') }}: {{ formatDateTime(u.created_at) }}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button @click="resetPassword(u)" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600">
              {{ $t('settings.users_reset_password') }}
            </button>
            <button v-if="u.id !== auth.user?.id" @click="deleteUser(u)" class="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
              {{ $t('common.delete') }}
            </button>
          </div>
        </li>
      </ul>
      <div class="flex flex-col sm:flex-row gap-2 max-w-md">
        <input v-model="newLogin" type="text" :placeholder="$t('auth.username')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <input v-model="newPassword" type="password" autocomplete="new-password" :placeholder="$t('auth.password')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <button @click="createUser" :disabled="userLoading || !newLogin.trim() || newPassword.length < 8" class="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {{ userLoading ? $t('common.loading') : $t('common.add') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'
import { formatDateTime as formatDateTimeValue } from '@/utils/format.js'
import { logger } from '@/utils/logger.js'
import { feedUrl } from '@/utils/recurring.js'
import { useAuthStore } from '../../stores/auth'
import { useRecurringStore } from '../../stores/recurring'

const { locale, t } = useI18n()
const auth = useAuthStore()
const recurring = useRecurringStore()

const isAdmin = computed(() => auth.user?.role === 'admin')

const totpEnabled = computed(() => Boolean(auth.user?.totp_enabled))
const setupStage = ref('idle')
const totpPassword = ref('')
const totpCode = ref('')
const totpSecret = ref('')
const totpQr = ref('')
const totpLoading = ref(false)

const tokens = ref([])
const newTokenName = ref('')
const newToken = ref('')
const tokenLoading = ref(false)

const users = ref([])
const newLogin = ref('')
const newPassword = ref('')
const userLoading = ref(false)

const newFeedName = ref('')
const feedLink = ref('')
const feedLinkId = ref(null)
const feedLoading = ref(false)

onMounted(() => {
  loadTokens()
  loadFeedTokens()
  if (isAdmin.value) loadUsers()
})

function formatDateTime(value) {
  if (!value) return '-'
  return formatDateTimeValue(value, locale.value)
}

async function startTotpSetup() {
  totpLoading.value = true
  try {
    const data = await api('/users/2fa/setup', { method: 'POST', body: JSON.stringify({ password: totpPassword.value }) })
    totpSecret.value = data.secret
    totpQr.value = data.qr
    setupStage.value = 'confirm'
  } catch (e) {
    logger.error('2FA setup failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    totpLoading.value = false
    totpPassword.value = ''
  }
}

async function enableTotp() {
  totpLoading.value = true
  try {
    await api('/users/2fa/enable', { method: 'POST', body: JSON.stringify({ code: totpCode.value }) })
    await auth.fetchMe()
    setupStage.value = 'idle'
    window.$toast?.success(t('settings.totp_enabled_success'))
  } catch (e) {
    logger.error('2FA enable failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    totpLoading.value = false
    totpCode.value = ''
  }
}

async function disableTotp() {
  totpLoading.value = true
  try {
    await api('/users/2fa/disable', { method: 'POST', body: JSON.stringify({ password: totpPassword.value, code: totpCode.value }) })
    await auth.fetchMe()
    window.$toast?.success(t('settings.totp_disabled_success'))
  } catch (e) {
    logger.error('2FA disable failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    totpLoading.value = false
    totpPassword.value = ''
    totpCode.value = ''
  }
}

async function loadTokens() {
  try {
    tokens.value = await api('/users/tokens')
  } catch (e) {
    logger.error('Failed to load API tokens', e)
  }
}

async function createToken() {
  tokenLoading.value = true
  try {
    const created = await api('/users/tokens', { method: 'POST', body: JSON.stringify({ name: newTokenName.value.trim() }) })
    newToken.value = created.token
    newTokenName.value = ''
    await loadTokens()
  } catch (e) {
    logger.error('Failed to create API token', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    tokenLoading.value = false
  }
}

async function revokeToken(id) {
  try {
    await api(`/users/tokens/${id}`, { method: 'DELETE' })
    await loadTokens()
    newToken.value = ''
  } catch (e) {
    logger.error('Failed to revoke API token', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}

async function loadFeedTokens() {
  try {
    await recurring.fetchFeedTokens()
  } catch (e) {
    logger.error('Failed to load calendar feed links', e)
  }
}

async function createFeed() {
  feedLoading.value = true
  try {
    const created = await recurring.createFeedToken(newFeedName.value.trim())
    feedLink.value = feedUrl(created.token)
    feedLinkId.value = created.id
    newFeedName.value = ''
  } catch (e) {
    logger.error('Failed to create calendar feed link', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    feedLoading.value = false
  }
}

async function revokeFeed(id) {
  try {
    await recurring.revokeFeedToken(id)
    if (id === feedLinkId.value) {
      feedLink.value = ''
      feedLinkId.value = null
    }
  } catch (e) {
    logger.error('Failed to revoke calendar feed link', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}

async function copyFeedLink() {
  try {
    await navigator.clipboard.writeText(feedLink.value)
    window.$toast?.success(t('settings.feed_copied'))
  } catch (e) {
    logger.error('Clipboard unavailable for calendar feed link', e)
    window.$toast?.error(t('settings.feed_copy_manual'))
  }
}

async function loadUsers() {
  try {
    users.value = await api('/admin/users')
  } catch (e) {
    logger.error('Failed to load users', e)
  }
}

async function createUser() {
  userLoading.value = true
  try {
    await api('/admin/users', { method: 'POST', body: JSON.stringify({ login: newLogin.value.trim(), password: newPassword.value }) })
    newLogin.value = ''
    newPassword.value = ''
    await loadUsers()
    window.$toast?.success(t('common.created'))
  } catch (e) {
    logger.error('Failed to create user', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    userLoading.value = false
  }
}

async function resetPassword(u) {
  const newPasswordValue = prompt(t('settings.users_new_password_prompt', { login: u.login }))
  if (!newPasswordValue || newPasswordValue.length < 8) return
  try {
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ password: newPasswordValue }) })
    window.$toast?.success(t('common.saved'))
  } catch (e) {
    logger.error('Failed to reset password', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}

async function deleteUser(u) {
  if (!(await window.$confirm({ message: t('settings.users_delete_confirm', { login: u.login }), danger: true }))) return
  try {
    await api(`/admin/users/${u.id}`, { method: 'DELETE' })
    await loadUsers()
  } catch (e) {
    logger.error('Failed to delete user', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}
</script>
