<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
    <div class="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-800">
      <div class="text-center mb-6">
        <div class="w-12 h-12 rounded-xl bg-primary-600 flex items-center justify-center mx-auto mb-4">
          <Icon name="money" class="w-7 h-7 text-white" />
        </div>
        <h1 class="text-xl font-bold text-slate-900 dark:text-slate-100">{{ $t('auth.setup') }}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">{{ $t('auth.setup_subtitle') }}</p>
      </div>
      <form @submit.prevent="handleSetup" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.username') }}</label>
          <input v-model="form.login" type="text" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{{ $t('auth.password') }}</label>
          <input v-model="form.password" type="password" required class="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <button type="submit" :disabled="loading" class="w-full py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium transition-colors">
          {{ loading ? $t('common.loading') : $t('auth.create') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api'

const { t } = useI18n()
const router = useRouter()
const form = reactive({ login: '', password: '' })
const loading = ref(false)

async function handleSetup() {
  const lang = localStorage.getItem('lang') || (navigator.language.startsWith('ru') ? 'ru' : 'en')
  loading.value = true
  try {
    await api('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ ...form, language: lang })
    })
    window.$toast?.success(t('common.saved'))
    router.push('/login')
  } catch (e) {
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    loading.value = false
  }
}
</script>
