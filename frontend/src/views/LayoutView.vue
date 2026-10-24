<template>
  <div class="min-h-screen bg-app dark:bg-app-dark text-slate-900 dark:text-slate-100 lg:p-4">
    <!-- App frame: white rounded canvas floating on the lavender background -->
    <div class="bg-white dark:bg-slate-950 lg:rounded-[2rem] lg:shadow-float dark:lg:shadow-card-dark flex min-h-screen lg:min-h-[calc(100vh-2rem)]">
      <!-- Sidebar (desktop) -->
      <aside class="hidden lg:flex w-64 shrink-0 flex-col sticky top-4 h-[calc(100vh-2rem)] pt-6 pb-4">
        <router-link to="/" class="flex items-center px-6 mb-8">
          <div class="w-10 h-10 rounded-2xl mr-3 overflow-hidden flex-shrink-0 shadow-card">
            <img src="/icon-192.png" alt="FinApp" class="w-full h-full object-cover" />
          </div>
          <span class="font-display font-semibold text-lg tracking-tight">FinApp</span>
        </router-link>
        <nav class="flex-1 px-3 space-y-1 overflow-y-auto">
          <router-link v-for="item in navItems" :key="item.name" :to="item.path"
            class="flex items-center px-4 py-2.5 rounded-full text-sm font-medium transition-colors"
            :class="$route.path === item.path ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-300 font-semibold' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'">
            <Icon :name="item.icon" :class="item.iconClass" class="mr-3" />
            {{ $t(item.labelKey) }}
          </router-link>
        </nav>
        <div class="px-3 pt-4">
          <button @click="logout" class="w-full flex items-center px-4 py-2.5 rounded-full text-sm font-medium text-slate-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 hover:text-danger-500 transition-colors">
            <Icon name="logout" class="w-5 h-5 mr-3" />
            {{ $t('auth.logout') }}
          </button>
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 pb-28 lg:pb-8">
        <!-- Header -->
        <header class="sticky top-0 z-30 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md flex items-center gap-3 justify-between px-4 lg:px-8 py-3 lg:py-4">
          <div class="flex items-center min-w-0 gap-4">
            <div class="flex items-center lg:hidden">
              <div class="w-9 h-9 rounded-xl mr-2.5 overflow-hidden flex-shrink-0">
                <img src="/icon-192.png" alt="FinApp" class="w-full h-full object-cover" />
              </div>
              <span class="font-display font-semibold tracking-tight">FinApp</span>
            </div>
            <h1 class="hidden lg:block font-display text-2xl font-semibold tracking-tight truncate">
              {{ greeting }}, <span class="text-primary-500">{{ displayName }}</span>
            </h1>
            <button @click="showCommandPalette = true"
              class="hidden lg:flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              <Icon name="search" class="w-4 h-4" />
              <span class="flex-1 text-left">{{ $t('common.search') }}</span>
              <kbd class="text-[10px] font-sans font-semibold bg-white dark:bg-slate-900 rounded-md px-1.5 py-0.5 shadow-sm text-slate-400">Ctrl ⇧ K</kbd>
            </button>
          </div>
          <div class="flex items-center gap-1.5 lg:gap-2">
            <!-- Notifications bell -->
            <div class="relative" ref="notifDropdownRef">
              <button @click="showNotifs = !showNotifs" class="p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors relative">
                <Icon name="bell" class="w-5 h-5" />
                <span v-if="notifStore.unreadCount > 0" class="absolute top-1.5 right-1.5 w-2 h-2 bg-danger-500 rounded-full ring-2 ring-white dark:ring-slate-800"></span>
              </button>
              <!-- Dropdown -->
              <div v-if="showNotifs" class="absolute right-0 mt-3 w-80 bg-white dark:bg-slate-900 rounded-3xl shadow-float z-50 max-h-96 overflow-y-auto">
                <div class="px-5 py-4 flex items-center justify-between">
                  <span class="font-display font-semibold text-sm">{{ $t('notifications.title') }}</span>
                  <button v-if="notifStore.items.some(n => !n.is_read)" @click="notifStore.markAllRead()" class="text-xs text-primary-500 hover:underline">{{ $t('notifications.mark_all') }}</button>
                </div>
                <div class="px-5 pb-3">
                  <select v-model="notifStore.filterType" @change="notifStore.fetchNotifications()" class="w-full text-xs bg-slate-100 dark:bg-slate-800 border-0 rounded-xl px-3 py-2">
                    <option value="">{{ $t('common.all') }}</option>
                    <option value="budget_exceeded">{{ $t('budgets.title') }} — {{ $t('budgets.exceeded') }}</option>
                    <option value="budget_warning">{{ $t('budgets.title') }} — {{ $t('budgets.warning') }}</option>
                    <option value="goal_reached">{{ $t('accounts.goals_title') }}</option>
                    <option value="debt_due_soon">{{ $t('debts.title') }} — {{ $t('debts.due') }}</option>
                    <option value="debt_paid">{{ $t('debts.title') }} — {{ $t('debts.status_paid') }}</option>
                    <option value="account_overdrawn">{{ $t('dashboard.total_balance') }}</option>
                    <option value="recurring_created">{{ $t('recurring.title') }}</option>
                    <option value="login_failed">{{ $t('auth.login') }}</option>
                  </select>
                </div>
                <div v-if="notifStore.loading" class="p-5 text-center text-sm text-slate-500">{{ $t('common.loading') }}</div>
                <div v-else-if="notifStore.items.length === 0" class="p-5 text-center text-sm text-slate-500">
                  <p class="mb-2">{{ $t('notifications.empty') }}</p>
                  <button v-if="notifStore.unreadCount > 0" @click="notifStore.markAllRead()" class="text-xs text-primary-500 hover:underline">{{ $t('notifications.mark_all') }}</button>
                </div>
                <div v-else class="divide-y divide-slate-100 dark:divide-slate-800">
                  <div v-for="n in notifStore.items" :key="n.id" class="p-4 flex gap-3 items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" @click="openNotif(n)">
                    <div class="w-2 h-2 mt-1.5 rounded-full flex-shrink-0" :class="n.is_read ? 'bg-slate-300 dark:bg-slate-600' : 'bg-primary-500'"></div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate">{{ n.title }}</p>
                      <p class="text-xs text-slate-500 truncate">{{ n.message }}</p>
                      <p class="text-xs text-slate-400 mt-1">{{ formatNotifDate(n.created_at) }}</p>
                    </div>
                    <button @click.stop="notifStore.remove(n.id)" class="text-slate-400 hover:text-danger-500">
                      <Icon name="cancel" class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <!-- GitHub Button -->
            <div class="relative" ref="githubDropdownRef">
              <button @click="showGithubMenu = !showGithubMenu" class="p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors relative">
                <Icon name="github" class="w-5 h-5" />
                <span v-if="hasUpdate" class="absolute top-1.5 right-1.5 w-2 h-2 bg-danger-500 rounded-full ring-2 ring-white dark:ring-slate-800"></span>
              </button>
              <!-- Dropdown -->
              <div v-if="showGithubMenu" class="absolute right-0 mt-3 w-64 bg-white dark:bg-slate-900 rounded-3xl shadow-float z-50 overflow-hidden">
                <div class="px-5 py-4">
                  <p class="text-sm font-medium" v-if="hasUpdate">
                    {{ $t('github.update_available', { version: latestVersion }) }}
                  </p>
                  <p class="text-sm font-medium" v-else-if="checkingUpdates">
                    {{ $t('github.checking_updates') }}
                  </p>
                  <p class="text-sm text-slate-500 dark:text-slate-400" v-else>
                    {{ $t('github.current_version', { version: currentVersion }) }}
                  </p>
                </div>
                <div class="py-1">
                  <a href="https://github.com/John710/finapp/issues" target="_blank" rel="noopener noreferrer"
                    class="flex items-center gap-3 px-5 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    @click="showGithubMenu = false"
                    @mouseenter="isHoveringIssue = true"
                    @mouseleave="isHoveringIssue = false">
                    <Icon name="alert02" class="w-5 h-5 transition-colors" :class="isHoveringIssue ? 'text-danger-500' : 'text-slate-400'" />
                    {{ $t('github.issue') }}
                  </a>
                  <a href="https://github.com/John710/finapp" target="_blank" rel="noopener noreferrer"
                    class="flex items-center gap-3 px-5 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    @click="showGithubMenu = false"
                    @mouseenter="isHoveringStar = true"
                    @mouseleave="isHoveringStar = false">
                    <Icon name="star" class="w-5 h-5 transition-colors" :class="isHoveringStar ? 'text-yellow-500' : 'text-slate-400'" />
                    {{ $t('github.star') }}
                  </a>
                </div>
              </div>
            </div>
            <button @click="toggleTheme" class="p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              <Icon v-if="isDark" name="sun" class="w-5 h-5" />
              <Icon v-else name="moon" class="w-5 h-5" />
            </button>
            <!-- Avatar -->
            <div class="w-10 h-10 rounded-full bg-primary-500 text-white text-sm font-semibold flex items-center justify-center shadow-card select-none ml-1">
              {{ initials }}
            </div>
          </div>
        </header>

        <!-- Page content -->
        <div class="p-4 lg:p-8 max-w-7xl mx-auto">
          <router-view />
        </div>
      </main>
    </div>

    <!-- Bottom nav (mobile): floating pill bar -->
    <nav class="lg:hidden fixed bottom-3 left-3 right-3 bg-white dark:bg-slate-900 rounded-3xl shadow-float z-50 flex gap-1 overflow-x-auto px-2 py-2">
      <router-link v-for="item in mobileNavItems" :key="item.name" :to="item.path"
        class="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors flex-shrink-0"
        :class="$route.path === item.path ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-300' : 'text-slate-400 dark:text-slate-500'">
        <Icon :name="item.icon" :class="item.iconClass" />
        <span>{{ $t(item.labelKey) }}</span>
      </router-link>
    </nav>

    <!-- Undo toast -->
    <transition name="slide-up">
      <div v-if="undo.toast.value" class="fixed bottom-24 lg:bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-3 rounded-full shadow-float flex items-center gap-4 text-sm">
        <span>{{ undo.toast.value.message }}</span>
        <button @click="undo.undo()" class="font-semibold text-primary-300 dark:text-primary-600 hover:underline">{{ $t('common.undo') }}</button>
        <button @click="undo.dismiss()" class="text-slate-400 dark:text-slate-500 hover:text-white dark:hover:text-slate-900">
          <Icon name="cancel" class="w-4 h-4" />
        </button>
      </div>
    </transition>

    <CommandPalette v-model="showCommandPalette" />
    <HelpModal v-model="showHelp" />
    <ConfirmModal ref="confirmModalRef" />
  </div>
</template>

<script setup>
import { logger } from '@/utils/logger.js'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useNotificationsStore } from '../stores/notifications'
import { useUndo } from '@/composables/useUndo'
import { useTheme } from '@/composables/useTheme'
import { useClickOutside } from '@/composables/useClickOutside'
import { formatNotifDate } from '@/utils/format'
import CommandPalette from '@/components/CommandPalette.vue'
import HelpModal from '@/components/HelpModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import packageJson from '../../package.json'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const notifStore = useNotificationsStore()
const undo = useUndo(route.name?.toLowerCase() || 'global')
const { t } = useI18n()

const currentVersion = packageJson.version
const latestVersion = ref('')
const checkingUpdates = ref(false)
const hasUpdate = ref(false)

const showCommandPalette = ref(false)
const showHelp = ref(false)
const confirmModalRef = ref(null)

const { isDark, toggleTheme } = useTheme()
const showNotifs = ref(false)
const showGithubMenu = ref(false)
const isHoveringIssue = ref(false)
const isHoveringStar = ref(false)
const notifDropdownRef = ref(null)
const githubDropdownRef = ref(null)

useClickOutside([notifDropdownRef, githubDropdownRef], () => {
  showNotifs.value = false
  showGithubMenu.value = false
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return t('dashboard.greeting_morning')
  if (h < 18) return t('dashboard.greeting_afternoon')
  if (h < 23) return t('dashboard.greeting_evening')
  return t('dashboard.greeting_night')
})

const displayName = computed(() => auth.user?.login || 'FinApp')

const initials = computed(() => (auth.user?.login || 'F').slice(0, 2).toUpperCase())

// Global confirm for views (toasts are initialized app-wide in App.vue)
if (typeof window !== 'undefined') {
  window.$confirm = (opts) => confirmModalRef.value?.open(opts)
}

// Global hotkeys — use window listener for reliability across layouts
function onGlobalKeydown(e) {
  // Ctrl+Shift+K → Command palette
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyK') {
    e.preventDefault()
    showCommandPalette.value = true
    return
  }
  // Shift+/ (?) → Help (ignore when typing in inputs)
  if (e.code === 'Slash' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const tag = e.target?.tagName?.toLowerCase()
    if (tag !== 'input' && tag !== 'textarea' && !e.target?.isContentEditable) {
      e.preventDefault()
      showHelp.value = true
    }
    return
  }
  // Esc → Close help modal or github menu
  if (e.key === 'Escape') {
    if (showHelp.value) {
      e.preventDefault()
      showHelp.value = false
    }
    if (showGithubMenu.value) {
      e.preventDefault()
      showGithubMenu.value = false
    }
    return
  }
  // Ctrl+Shift+N → New transaction
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyN') {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('open-transaction-modal'))
    return
  }
}

async function checkForUpdates() {
  checkingUpdates.value = true
  hasUpdate.value = false
  latestVersion.value = ''
  try {
    const res = await fetch('https://api.github.com/repos/John710/finapp/releases/latest')
    if (res.ok) {
      const data = await res.json()
      const tag = data.tag_name.replace(/^v/, '') // strip leading 'v'
      latestVersion.value = tag
      // Compare versions numerically by segments
      hasUpdate.value = isVersionGreater(tag, currentVersion)
    }
  } catch (e) {
    logger.error('Failed to check for updates:', e)
  } finally {
    checkingUpdates.value = false
  }
}

let notifPollInterval = null

function startNotifPoll() {
  notifPollInterval = setInterval(() => {
    notifStore.fetchUnreadCount()
  }, 60000)
}

function onVisibilityChange() {
  if (document.hidden) {
    if (notifPollInterval) {
      clearInterval(notifPollInterval)
      notifPollInterval = null
    }
  } else {
    notifStore.fetchUnreadCount()
    if (!notifPollInterval) startNotifPoll()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  notifStore.fetchUnreadCount()
  notifStore.fetchNotifications()
  checkForUpdates()
  startNotifPoll()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  if (notifPollInterval) clearInterval(notifPollInterval)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

function openNotif(n) {
  if (!n.is_read) notifStore.markRead(n.id)
  showNotifs.value = false
  if (n.data?.url) router.push(n.data.url)
}

function isVersionGreater(latest, current) {
  const parse = (v) => v.replace(/^v/, '').split('.').map(Number).filter(n => !Number.isNaN(n))
  const l = parse(latest)
  const c = parse(current)
  const len = Math.max(l.length, c.length)
  for (let i = 0; i < len; i++) {
    const lv = l[i] || 0
    const cv = c[i] || 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

const pageTitle = computed(() => {
  const key = route.name?.toLowerCase()
  if (!key) return ''
  return t(`nav.${key}`)
})

async function logout() {
  await auth.logout()
  router.push('/login')
}

const navItems = [
  { path: '/', name: 'dashboard', labelKey: 'nav.dashboard', icon: 'home', iconClass: 'w-5 h-5' },
  { path: '/transactions', name: 'transactions', labelKey: 'nav.transactions', icon: 'creditCard', iconClass: 'w-5 h-5' },
  { path: '/accounts', name: 'accounts', labelKey: 'nav.accounts', icon: 'layers', iconClass: 'w-5 h-5' },
  { path: '/categories', name: 'categories', labelKey: 'nav.categories', icon: 'folder', iconClass: 'w-5 h-5' },
  { path: '/budgets', name: 'budgets', labelKey: 'nav.budgets', icon: 'wallet', iconClass: 'w-5 h-5' },
  { path: '/debts', name: 'debts', labelKey: 'nav.debts', icon: 'briefcase', iconClass: 'w-5 h-5' },
  { path: '/recurring', name: 'recurring', labelKey: 'nav.recurring', icon: 'repeat', iconClass: 'w-5 h-5' },
  { path: '/reports', name: 'reports', labelKey: 'nav.reports', icon: 'chart', iconClass: 'w-5 h-5' },
  { path: '/tags', name: 'tags', labelKey: 'nav.tags', icon: 'tag', iconClass: 'w-5 h-5' },
  { path: '/settings', name: 'settings', labelKey: 'nav.settings', icon: 'settings', iconClass: 'w-5 h-5' }
]

const mobileNavItems = [
  { path: '/', name: 'dashboard', labelKey: 'nav.dashboard', icon: 'home', iconClass: 'w-5 h-5' },
  { path: '/transactions', name: 'transactions', labelKey: 'nav.transactions', icon: 'creditCard', iconClass: 'w-5 h-5' },
  { path: '/accounts', name: 'accounts', labelKey: 'nav.accounts', icon: 'layers', iconClass: 'w-5 h-5' },
  { path: '/categories', name: 'categories', labelKey: 'nav.categories', icon: 'folder', iconClass: 'w-5 h-5' },
  { path: '/budgets', name: 'budgets', labelKey: 'nav.budgets', icon: 'wallet', iconClass: 'w-5 h-5' },
  { path: '/debts', name: 'debts', labelKey: 'nav.debts', icon: 'briefcase', iconClass: 'w-5 h-5' },
  { path: '/recurring', name: 'recurring', labelKey: 'nav.recurring', icon: 'repeat', iconClass: 'w-5 h-5' },
  { path: '/tags', name: 'tags', labelKey: 'nav.tags', icon: 'tag', iconClass: 'w-5 h-5' },
  { path: '/settings', name: 'settings', labelKey: 'nav.settings', icon: 'settings', iconClass: 'w-5 h-5' }
]
</script>
