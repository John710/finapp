<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.data_title') }}</h2>
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
          {{ demoLoading ? $t('common.loading') : $t('settings.load') }}
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
          {{ clearLoading ? $t('common.loading') : $t('settings.clear') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'
import { logger } from '@/utils/logger.js'

const { t } = useI18n()
const demoLoading = ref(false)
const clearLoading = ref(false)

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
    logger.error('Load demo data failed', e)
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
    logger.error('Clear database failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    clearLoading.value = false
  }
}
</script>
