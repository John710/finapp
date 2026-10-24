<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800 mb-6">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.notifications_title') }}</h2>
    </div>

    <!-- VAPID -->
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
            class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm disabled:opacity-50"
          />
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="generateVapidKeys"
            :disabled="vapidLoading || vapidDeleteLoading || !vapidEmail"
            class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {{ vapidLoading ? $t('common.loading') : (auth.user?.vapid_public_key ? $t('settings.vapid_regenerate') : $t('settings.vapid_generate')) }}
          </button>
          <button
            v-if="auth.user?.vapid_public_key"
            @click="deleteVapidKeys"
            :disabled="vapidLoading || vapidDeleteLoading"
            class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {{ vapidDeleteLoading ? $t('common.loading') : $t('settings.vapid_delete') }}
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
          {{ testLoading ? $t('common.loading') : $t('settings.push_test') }}
        </button>
        <button
          @click="push.unsubscribe()"
          :disabled="push.loading.value"
          class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
        >
          {{ push.loading.value ? $t('common.loading') : $t('settings.push_unsubscribe') }}
        </button>
      </div>
      <div v-else-if="!push.serverConfigured.value" class="text-sm text-amber-600 dark:text-amber-400">{{ $t('settings.push_not_configured') }}</div>
      <button
        v-else
        @click="push.subscribe()"
        :disabled="push.loading.value"
        class="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
      >
        {{ push.loading.value ? $t('common.loading') : $t('settings.push_subscribe') }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePush } from '@/composables/usePush.js'
import { api } from '@/utils/api.js'
import { logger } from '@/utils/logger.js'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'

const { t } = useI18n()
const auth = useAuthStore()
const settingsStore = useSettingsStore()
const push = usePush()
const testLoading = ref(false)

const vapidEmail = ref('')
const vapidLoading = ref(false)
const vapidDeleteLoading = ref(false)

const vapidSubjectEmail = computed(() => auth.user?.vapid_subject?.replace(/^mailto:/i, '') || '')

onMounted(() => {
  push.getSubscription()
  if (auth.user?.vapid_subject) {
    vapidEmail.value = auth.user.vapid_subject.replace(/^mailto:/i, '')
  }
})

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
    const result = await settingsStore.generateVapidKeys(email)
    push.serverConfigured.value = !!result.publicKey
    await auth.fetchMe()
    vapidEmail.value = (auth.user?.vapid_subject || '').replace(/^mailto:/i, '')
    await push.checkServerConfigured()
    // Server deleted old subscriptions; browser subscription is tied to old keys
    if (push.subscription.value) {
      try {
        await push.subscription.value.unsubscribe()
      } catch {
        // best-effort unsubscribe: ignore push errors
      }
      push.subscription.value = null
    }
    window.$toast?.success(t('settings.vapid_generated_success'))
  } catch (e) {
    logger.error('Failed to generate VAPID keys', e)
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
    push.serverConfigured.value = false
    await auth.fetchMe()
    vapidEmail.value = ''
    await push.checkServerConfigured()
    if (push.subscription.value) {
      try {
        await push.subscription.value.unsubscribe()
      } catch {
        // best-effort unsubscribe: ignore push errors
      }
      push.subscription.value = null
    }
    window.$toast?.success(t('settings.vapid_deleted_success'))
  } catch (e) {
    logger.error('Failed to delete VAPID keys', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    vapidDeleteLoading.value = false
  }
}

async function sendTestPush() {
  testLoading.value = true
  try {
    const data = await api('/send-test', { method: 'POST', body: JSON.stringify({}) })
    window.$toast?.success(`${t('notifications.test_push_sent')}: ${data.sent} / ${data.failed}`)
  } catch (e) {
    logger.error('Test push failed', e)
    window.$toast?.error(e.message || t('notifications.test_push_failed'))
  } finally {
    testLoading.value = false
  }
}
</script>
