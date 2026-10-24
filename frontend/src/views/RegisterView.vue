<template>
  <div class="min-h-screen flex items-center justify-center bg-app dark:bg-app-dark px-4">
    <div class="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-card dark:shadow-none border-0">
      <div class="text-center mb-6">
        <div class="w-12 h-12 rounded-xl mx-auto mb-4 overflow-hidden flex-shrink-0">
          <img src="/icon-192.png" alt="FinApp" class="w-full h-full object-cover" />
        </div>
        <h1 class="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">{{ $t('auth.register') }}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">{{ $t('auth.register_subtitle') }}</p>
      </div>
      <form @submit.prevent="handleRegister" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.username') }}</label>
          <input
            v-model="form.login"
            type="text"
            autocomplete="username"
            required
            class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.password') }}</label>
          <input
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            required
            minlength="6"
            class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.confirm_password') }}</label>
          <input
            v-model="form.confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="6"
            class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.language') }}</label>
          <select
            v-model="form.language"
            class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option v-for="lang in availableLocales" :key="lang" :value="lang">
              {{ lang === 'ru' ? 'Русский' : 'English' }}
            </option>
          </select>
        </div>
        <button type="submit" :disabled="loading" class="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card disabled:opacity-50 text-white font-medium transition-colors">
          {{ loading ? $t('common.loading') : $t('auth.create_account') }}
        </button>
      </form>
      <p class="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
        {{ $t('auth.already_have_account') }}
        <router-link to="/login" class="text-primary-500 hover:text-primary-600 font-medium">
          {{ $t('auth.go_to_login') }}
        </router-link>
      </p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api'
import i18n from '@/i18n'

const { t } = useI18n()
const router = useRouter()

const availableLocales = i18n.global.availableLocales
const form = reactive({
  login: '',
  password: '',
  confirmPassword: '',
  language: i18n.global.locale.value || 'en'
})
const loading = ref(false)

onMounted(async () => {
  try {
    const res = await fetch('/api/v1/auth/setup-required')
    if (res.ok) {
      const data = await res.json()
      if (!data.required) {
        router.push('/login')
      }
    }
  } catch (e) {
    // ignore
  }
})

async function handleRegister() {
  if (form.password !== form.confirmPassword) {
    window.$toast?.error(t('auth.password_mismatch'))
    return
  }
  loading.value = true
  try {
    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        login: form.login,
        password: form.password,
        language: form.language
      })
    })
    try {
      localStorage.setItem('lang', form.language)
    } catch (e) {
      // ignore
    }
    window.$toast?.success(t('auth.account_created'))
    router.push('/login')
  } catch (e) {
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    loading.value = false
  }
}
</script>
