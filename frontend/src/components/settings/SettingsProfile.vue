<template>
  <section class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark divide-y divide-slate-100 dark:divide-slate-800 mb-6">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800">
      <h2 class="font-semibold">{{ $t('settings.profile_title') }}</h2>
    </div>
    <!-- Avatar -->
    <div class="p-5 flex items-center gap-4">
      <div class="w-16 h-16 rounded-full overflow-hidden bg-primary-500 text-white text-xl font-semibold flex items-center justify-center shadow-card select-none flex-shrink-0">
        <img v-if="auth.user?.avatar_set" :src="avatarUrl" :alt="$t('settings.avatar')" class="w-full h-full object-cover" />
        <template v-else>{{ initials }}</template>
      </div>
      <div class="min-w-0">
        <p class="font-medium">{{ $t('settings.avatar') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.avatar_desc') }}</p>
        <div class="flex gap-2 mt-2">
          <button
            :disabled="avatarLoading"
            class="px-4 py-1.5 rounded-full bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50"
            @click="avatarFileInput?.click()"
          >
            {{ avatarLoading ? $t('common.loading') : $t('settings.avatar_upload') }}
          </button>
          <button
            v-if="auth.user?.avatar_set"
            :disabled="avatarLoading"
            class="px-4 py-1.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
            @click="removeAvatar"
          >
            {{ $t('settings.avatar_remove') }}
          </button>
        </div>
      </div>
      <input ref="avatarFileInput" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" :aria-label="$t('settings.avatar')" class="hidden" @change="onAvatarChange" />
    </div>
    <div class="p-5 flex items-center justify-between">
      <div>
        <p class="font-medium">{{ $t('settings.theme') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.theme_desc') }}</p>
      </div>
      <select v-model="theme" :aria-label="$t('settings.theme')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" @change="changeTheme">
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
      <select v-model="locale" :aria-label="$t('settings.language')" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" @change="changeLang">
        <option value="ru">{{ $t('settings.lang_ru') }}</option>
        <option value="en">{{ $t('settings.lang_en') }}</option>
      </select>
    </div>
    <div class="p-5 flex items-center justify-between">
      <div>
        <p class="font-medium">{{ $t('settings.base_currency') }}</p>
        <p class="text-sm text-slate-500">{{ $t('settings.base_currency_desc') }}</p>
      </div>
      <div ref="selectRef" class="relative w-48">
        <button type="button" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-left text-sm flex items-center justify-between" @click="showDropdown = !showDropdown">
          <span>{{ selectedCurrency?.code }} ({{ selectedCurrency?.symbol || selectedCurrency?.code }})</span>
          <Icon name="arrowDown" class="w-4 h-4 text-slate-400" />
        </button>
        <div v-if="showDropdown" class="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 rounded-lg border-0 bg-slate-100 dark:bg-slate-800 shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div class="p-2 border-b border-slate-100 dark:border-slate-800">
            <input ref="searchInput" v-model="search" type="text" :placeholder="$t('common.search')" :aria-label="$t('common.search')" class="w-full px-2 py-1.5 text-sm rounded-md border-0 bg-slate-100 dark:bg-slate-800 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-400" @keydown="onKeydown" />
          </div>
          <div class="overflow-y-auto flex-1">
            <button
v-for="fc in filteredCurrencies" :key="fc.code" type="button" class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between transition-colors"
              :class="baseCurrency === fc.code ? 'bg-primary-100 dark:bg-primary-500/15 text-primary-600' : ''"
              @click="selectCurrency(fc)">
              <span class="font-medium">{{ fc.code }}</span>
              <span class="text-slate-500 text-xs">{{ fc.name }}</span>
            </button>
            <div v-if="filteredCurrencies.length === 0" class="px-3 py-4 text-sm text-slate-500 text-center">{{ $t('common.empty') }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme.js'
import { logger } from '@/utils/logger.js'
import { useAuthStore } from '../../stores/auth'
import { useRatesStore } from '../../stores/rates'
import Icon from '../Icon.vue'

const { locale, t } = useI18n()
const auth = useAuthStore()
const ratesStore = useRatesStore()
const { setTheme } = useTheme()
const theme = ref(localStorage.getItem('theme') || 'auto')
const baseCurrency = ref(localStorage.getItem('base_currency') || 'USD')

const showDropdown = ref(false)
const search = ref('')
const selectRef = ref(null)
const searchInput = ref(null)

// Avatar upload: resized client-side to keep the stored data URL small
const avatarFileInput = ref(null)
const avatarLoading = ref(false)
const avatarBust = ref(Date.now())
const avatarUrl = computed(() => `/api/v1/users/me/avatar?v=${avatarBust.value}`)
// Same convention as the header avatar
const initials = computed(() => (auth.user?.login || 'F').slice(0, 2).toUpperCase())

// Decode via createImageBitmap first (handles EXIF orientation), fall back to
// an <img> + object URL. Both failures reject with a sentinel that the caller
// maps to a localized message.
class AvatarDecodeError extends Error {}

async function decodeFile(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through to the <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new AvatarDecodeError('image decode failed'))
    }
    img.src = url
  })
}

async function resizeImage(file, max) {
  const source = await decodeFile(file)
  const sw = source.width || source.naturalWidth
  const sh = source.height || source.naturalHeight
  if (!sw || !sh) throw new AvatarDecodeError('image has no dimensions')
  const scale = Math.min(1, max / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(source, 0, 0, w, h)
  if (source.close) source.close()
  const webp = canvas.toDataURL('image/webp', 0.9)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.9)
}

async function onAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  // Supported avatar formats: jpg, jpeg, png, webp, gif
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
    window.$toast?.error(t('settings.avatar_invalid'))
    e.target.value = ''
    return
  }
  avatarLoading.value = true
  try {
    const dataUrl = await resizeImage(file, 256)
    await auth.updateSettings({ avatar: dataUrl })
    await auth.fetchMe()
    avatarBust.value = Date.now()
    window.$toast?.success(t('common.saved'))
  } catch (err) {
    logger.error('Failed to upload avatar', err)
    // Never leak raw error text (it is English) — decode failures and
    // rejected formats get the same localized, actionable message
    window.$toast?.error(err instanceof AvatarDecodeError ? t('settings.avatar_invalid') : t('common.error'))
  } finally {
    avatarLoading.value = false
    if (avatarFileInput.value) avatarFileInput.value.value = ''
  }
}

async function removeAvatar() {
  avatarLoading.value = true
  try {
    await auth.updateSettings({ avatar: null })
    await auth.fetchMe()
    avatarBust.value = Date.now()
    window.$toast?.success(t('common.saved'))
  } catch (err) {
    logger.error('Failed to remove avatar', err)
    window.$toast?.error(err.message || t('common.error'))
  } finally {
    avatarLoading.value = false
  }
}

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

onMounted(() => {
  ratesStore.fetchRates()
  if (auth.user?.base_currency) baseCurrency.value = auth.user.base_currency
  document.addEventListener('click', onDocClick)
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
  setTheme(theme.value)
  window.$toast?.success(t('common.saved'))
}

async function changeLang() {
  localStorage.setItem('lang', locale.value)
  if (auth.isAuthenticated) {
    try {
      await auth.updateLanguage(locale.value)
      window.$toast?.success(t('common.saved'))
    } catch (e) {
      logger.error('Failed to sync language', e)
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
      logger.error('Failed to sync base currency', e)
      window.$toast?.error(t('common.error'))
    }
  } else {
    window.$toast?.success(t('common.saved'))
  }
}
</script>
