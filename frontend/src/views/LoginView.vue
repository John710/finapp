<template>
  <div class="min-h-screen flex items-center justify-center bg-app dark:bg-app-dark px-4">
    <div class="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-card dark:shadow-card-dark border-0">
      <div class="text-center mb-6">
        <div class="w-12 h-12 rounded-xl mx-auto mb-4 overflow-hidden flex-shrink-0">
          <img src="/icon-192.png" alt="FinApp" class="w-full h-full object-cover" />
        </div>
        <h1 class="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">{{ $t('auth.login') }}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">{{ $t('auth.login_subtitle') }}</p>
      </div>
      <form class="space-y-4" @submit.prevent="handleLogin">
        <div>
          <label :for="`${uid}-login`" class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.username') }}</label>
          <input :id="`${uid}-login`" v-model="form.login" type="text" autocomplete="username" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </div>
        <div>
          <label :for="`${uid}-password`" class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.password') }}</label>
          <input :id="`${uid}-password`" v-model="form.password" type="password" autocomplete="current-password" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </div>
        <div v-if="totpRequired">
          <label :for="`${uid}-totp`" class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.totp_code') }}</label>
          <input :id="`${uid}-totp`" v-model="form.totp_code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400 tracking-widest" />
        </div>
        <button type="submit" :disabled="loading" class="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card disabled:opacity-50 text-white font-medium transition-colors">
          {{ loading ? $t('common.loading') : $t('auth.submit') }}
        </button>
      </form>
      <p class="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
        {{ $t('auth.no_account') }}
        <router-link to="/register" class="text-primary-500 hover:text-primary-600 font-medium">
          {{ $t('auth.go_to_register') }}
        </router-link>
      </p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, useId } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const uid = useId()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const form = reactive({ login: '', password: '', totp_code: '' })
const loading = ref(false)
const totpRequired = ref(false)

async function handleLogin() {
  loading.value = true
  try {
    await auth.login(form.login, form.password, form.totp_code)
    // Return the user to the page they were trying to open (set by the router guard)
    const redirect = typeof route.query.redirect === 'string' && /^\/(?![/\\])/.test(route.query.redirect)
      ? route.query.redirect
      : '/'
    router.push(redirect)
  } catch (e) {
    // The API signals a missing/invalid second factor with totp_required
    if (e?.totp_required) {
      totpRequired.value = true
      form.totp_code = ''
      window.$toast?.error(e.message || t('auth.totp_required'))
    } else {
      window.$toast?.error(e?.message || t('auth.invalid_credentials'))
    }
  } finally {
    loading.value = false
  }
}
</script>
