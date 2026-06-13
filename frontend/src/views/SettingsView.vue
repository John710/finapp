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
      <div class="p-5 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
        <div>
          <p class="font-medium">{{ $t('settings.test_notifications') }}</p>
          <p class="text-sm text-slate-500">{{ $t('settings.test_desc') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="sendTestShoutrrr()"
            :disabled="shoutrrrLoading"
            class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {{ shoutrrrLoading ? '...' : $t('settings.shoutrrr_test') }}
          </button>
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

const { locale, t } = useI18n()
const auth = useAuthStore()
const ratesStore = useRatesStore()
const theme = ref(localStorage.getItem('theme') || 'auto')
const baseCurrency = ref(localStorage.getItem('base_currency') || 'USD')
const coingeckoKey = ref('')
const savingKey = ref(false)
const push = usePush()
const testLoading = ref(false)
const shoutrrrLoading = ref(false)
const demoLoading = ref(false)
const clearLoading = ref(false)

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

async function sendTestShoutrrr() {
  shoutrrrLoading.value = true
  try {
    await api('/send-test-shoutrrr', { method: 'POST' })
    window.$toast?.success(t('notifications.test_shoutrrr_sent'))
  } catch (e) {
    console.error('Test shoutrrr failed', e)
    window.$toast?.error(e.message || t('notifications.test_shoutrrr_failed'))
  } finally {
    shoutrrrLoading.value = false
  }
}

async function loadDemoData() {
  if (!confirm(t('settings.load_demo_confirm'))) return
  demoLoading.value = true
  try {
    await api('/admin/load-demo', { method: 'POST' })
    window.$toast?.success(t('settings.load_demo_success'))
    // Reload all stores
    window.location.reload()
  } catch (e) {
    console.error('Load demo data failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    demoLoading.value = false
  }
}

async function clearDatabase() {
  if (!confirm(t('settings.clear_db_confirm'))) return
  clearLoading.value = true
  try {
    await api('/admin/clear-database', { method: 'POST' })
    window.$toast?.success(t('settings.clear_db_success'))
    // Reload all stores
    window.location.reload()
  } catch (e) {
    console.error('Clear database failed', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    clearLoading.value = false
  }
}
</script>
