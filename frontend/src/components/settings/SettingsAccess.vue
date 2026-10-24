<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800 mb-6">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.access_title') }}</h2>
    </div>

    <!-- Two-factor authentication -->
    <div class="p-5">
      <div class="mb-3">
        <p class="font-medium">{{ $t('settings.totp_title') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.totp_desc') }}</p>
      </div>
      <div v-if="totpEnabled" class="text-sm text-emerald-600 dark:text-emerald-400 mb-3">{{ $t('settings.totp_enabled') }}</div>
      <div v-else class="text-sm text-slate-500 mb-3">{{ $t('settings.totp_disabled') }}</div>

      <!-- Enable flow: password -> QR -> code -->
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
      <div v-else-if="totpEnabled" class="space-y-2 max-w-sm">
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

    <!-- Shared read-only viewers -->
    <div class="p-5">
      <div class="mb-3">
        <p class="font-medium">{{ $t('settings.viewers_title') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.viewers_desc') }}</p>
      </div>
      <ul v-if="viewers.length" class="space-y-2 mb-3">
        <li v-for="v in viewers" :key="v.id" class="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div class="text-sm">
            <span class="font-medium">{{ v.login }}</span>
            <p class="text-xs text-slate-500">{{ $t('settings.viewer_since') }}: {{ formatDateTime(v.created_at) }}</p>
          </div>
          <button @click="removeViewer(v.id)" class="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
            {{ $t('common.delete') }}
          </button>
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500 mb-3">{{ $t('settings.viewers_empty') }}</p>
      <div class="flex flex-col sm:flex-row gap-2 max-w-md">
        <input v-model="viewerLogin" type="text" :placeholder="$t('auth.username')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <input v-model="viewerPassword" type="password" autocomplete="new-password" :placeholder="$t('auth.password')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
        <button @click="createViewer" :disabled="viewerLoading || !viewerLogin.trim() || viewerPassword.length < 8" class="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {{ viewerLoading ? $t('common.loading') : $t('common.add') }}
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
import { useAuthStore } from '../../stores/auth'

const { locale, t } = useI18n()
const auth = useAuthStore()

const totpEnabled = computed(() => Boolean(auth.user?.totp_enabled))
const setupStage = ref('idle') // idle | confirm
const totpPassword = ref('')
const totpCode = ref('')
const totpSecret = ref('')
const totpQr = ref('')
const totpLoading = ref(false)

const tokens = ref([])
const newTokenName = ref('')
const newToken = ref('')
const tokenLoading = ref(false)

const viewers = ref([])
const viewerLogin = ref('')
const viewerPassword = ref('')
const viewerLoading = ref(false)

onMounted(() => {
  loadTokens()
  loadViewers()
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

async function loadViewers() {
  try {
    viewers.value = await api('/users/viewers')
  } catch (e) {
    logger.error('Failed to load viewers', e)
  }
}

async function createViewer() {
  viewerLoading.value = true
  try {
    await api('/users/viewers', { method: 'POST', body: JSON.stringify({ login: viewerLogin.value.trim(), password: viewerPassword.value }) })
    viewerLogin.value = ''
    viewerPassword.value = ''
    await loadViewers()
    window.$toast?.success(t('common.created'))
  } catch (e) {
    logger.error('Failed to create viewer', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    viewerLoading.value = false
  }
}

async function removeViewer(id) {
  if (!(await window.$confirm({ message: t('settings.viewer_remove_confirm') }))) return
  try {
    await api(`/users/viewers/${id}`, { method: 'DELETE' })
    await loadViewers()
  } catch (e) {
    logger.error('Failed to remove viewer', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}
</script>
