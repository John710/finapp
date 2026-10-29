<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800 mb-6">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.security_title') }}</h2>
    </div>

    <!-- Change password -->
    <div class="p-5">
      <div class="mb-3">
        <p class="font-medium">{{ $t('settings.password_title') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.password_desc') }}</p>
      </div>
      <div class="space-y-3 max-w-md">
        <div class="relative">
          <input v-model="currentPassword" autocomplete="current-password" :type="showPasswords.current ? 'text' : 'password'" :placeholder="$t('settings.password_current')" :aria-label="$t('settings.password_current')" class="w-full px-3 pr-10 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
          <button type="button" class="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" :aria-label="showPasswords.current ? $t('settings.password_hide') : $t('settings.password_show')" @click="showPasswords.current = !showPasswords.current">
            <Icon :name="showPasswords.current ? 'eyeOff' : 'eye'" size="18" />
          </button>
        </div>
        <div class="relative">
          <input v-model="newPassword" autocomplete="new-password" :type="showPasswords.new ? 'text' : 'password'" :placeholder="$t('settings.password_new')" :aria-label="$t('settings.password_new')" class="w-full px-3 pr-10 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
          <button type="button" class="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" :aria-label="showPasswords.new ? $t('settings.password_hide') : $t('settings.password_show')" @click="showPasswords.new = !showPasswords.new">
            <Icon :name="showPasswords.new ? 'eyeOff' : 'eye'" size="18" />
          </button>
        </div>
        <div class="relative">
          <input v-model="confirmPassword" autocomplete="new-password" :type="showPasswords.confirm ? 'text' : 'password'" :placeholder="$t('settings.password_confirm')" :aria-label="$t('settings.password_confirm')" class="w-full px-3 pr-10 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
          <button type="button" class="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" :aria-label="showPasswords.confirm ? $t('settings.password_hide') : $t('settings.password_show')" @click="showPasswords.confirm = !showPasswords.confirm">
            <Icon :name="showPasswords.confirm ? 'eyeOff' : 'eye'" size="18" />
          </button>
        </div>
        <button
          :disabled="passwordLoading || !currentPassword || !newPassword || newPassword !== confirmPassword || newPassword.length < 6"
          class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          @click="changePassword"
        >
          {{ passwordLoading ? $t('common.loading') : $t('settings.password_change') }}
        </button>
      </div>
    </div>

    <!-- Sessions -->
    <div class="p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <p class="font-medium">{{ $t('settings.sessions_title') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.sessions_desc') }}</p>
        </div>
        <button
          v-if="sessions.length > 1"
          :disabled="sessionsLoading"
          class="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          @click="logoutAllOtherSessions"
        >
          {{ sessionsLoading ? $t('common.loading') : $t('settings.sessions_terminate_all') }}
        </button>
      </div>
      <div v-if="sessions.length === 0" class="text-sm text-slate-500">{{ $t('settings.sessions_empty') }}</div>
      <ul v-else class="space-y-2">
        <li v-for="session in sessions" :key="session.id" class="flex items-center justify-between p-3 rounded-lg border-0 bg-slate-100 dark:bg-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div class="text-sm">
            <span class="font-medium">{{ formatDateTime(session.created_at) }}</span>
            <span v-if="session.is_current" class="ml-2 text-xs px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">{{ $t('settings.sessions_current') }}</span>
            <p class="text-xs text-slate-500">{{ $t('settings.sessions_expires') }}: {{ formatDateTime(session.expires_at) }}</p>
          </div>
          <button
            v-if="!session.is_current"
            :disabled="sessionsLoading"
            class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
            @click="terminateSession(session.id)"
          >
            {{ $t('settings.sessions_terminate') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime as formatDateTimeValue } from '@/utils/format.js'
import { logger } from '@/utils/logger.js'
import { useSettingsStore } from '../../stores/settings'
import Icon from '../Icon.vue'

const { locale, t } = useI18n()
const settingsStore = useSettingsStore()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordLoading = ref(false)
const showPasswords = ref({ current: false, new: false, confirm: false })
const sessions = ref([])
const sessionsLoading = ref(false)

onMounted(() => {
  loadSessions()
})

function formatDateTime(value) {
  if (!value) return '-'
  return formatDateTimeValue(value, locale.value)
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    const data = await settingsStore.fetchSessions()
    sessions.value = data.sessions || []
  } catch (e) {
    logger.error('Failed to load sessions', e)
  } finally {
    sessionsLoading.value = false
  }
}

async function changePassword() {
  if (newPassword.value !== confirmPassword.value) {
    window.$toast?.error(t('settings.password_mismatch'))
    return
  }
  if (newPassword.value.length < 6) {
    window.$toast?.error(t('settings.password_too_short'))
    return
  }
  passwordLoading.value = true
  try {
    await settingsStore.changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    showPasswords.value = { current: false, new: false, confirm: false }
    await loadSessions()
    window.$toast?.success(t('settings.password_changed'))
  } catch (e) {
    logger.error('Failed to change password', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    passwordLoading.value = false
  }
}

async function terminateSession(sessionId) {
  sessionsLoading.value = true
  try {
    await settingsStore.terminateSession(sessionId)
    await loadSessions()
    window.$toast?.success(t('settings.sessions_terminated'))
  } catch (e) {
    logger.error('Failed to terminate session', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    sessionsLoading.value = false
  }
}

async function logoutAllOtherSessions() {
  sessionsLoading.value = true
  try {
    await settingsStore.logoutAllSessions()
    await loadSessions()
    window.$toast?.success(t('settings.sessions_terminated'))
  } catch (e) {
    logger.error('Failed to logout all sessions', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    sessionsLoading.value = false
  }
}
</script>
