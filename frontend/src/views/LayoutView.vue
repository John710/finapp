<template>
  <div class="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
    <!-- Sidebar (desktop) -->
    <aside class="fixed left-0 top-0 h-full w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 hidden lg:flex flex-col z-40">
      <div class="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800">
        <div class="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center mr-3">
          <Icon name="money" class="w-5 h-5 text-white" />
        </div>
        <span class="font-bold text-lg tracking-tight">FinanceApp</span>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-1">
        <router-link v-for="item in navItems" :key="item.name" :to="item.path"
          class="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
          :class="$route.path === item.path ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'">
          <Icon :name="item.icon" :class="item.iconClass" class="mr-3" />
          {{ $t(item.labelKey) }}
        </router-link>
      </nav>
      <div class="p-4 border-t border-slate-200 dark:border-slate-800">
        <button @click="logout" class="w-full flex items-center px-3 py-2 text-sm text-slate-500 hover:text-danger-500 transition-colors">
          <Icon name="logout" class="w-5 h-5 mr-3" />
          {{ $t('auth.logout') }}
        </button>
      </div>
    </aside>

    <!-- Main content -->
    <main class="lg:ml-64 pb-20 lg:pb-0 min-h-screen">
      <!-- Header -->
      <header class="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
        <div class="flex items-center lg:hidden">
          <div class="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center mr-3">
            <Icon name="money" class="w-5 h-5 text-white" />
          </div>
          <span class="font-bold text-lg">FinanceApp</span>
        </div>
        <div class="hidden lg:block text-sm text-slate-500 dark:text-slate-400">{{ pageTitle }}</div>
        <div class="flex items-center gap-2">
          <!-- Notifications bell -->
          <div class="relative" ref="notifDropdownRef">
            <button @click="showNotifs = !showNotifs" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative">
              <Icon name="bell" class="w-5 h-5" />
              <span v-if="notifStore.unreadCount > 0" class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <!-- Dropdown -->
            <div v-if="showNotifs" class="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg z-50 max-h-96 overflow-y-auto">
              <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span class="font-semibold text-sm">{{ $t('notifications.title') }}</span>
                <button v-if="notifStore.items.some(n => !n.is_read)" @click="notifStore.markAllRead()" class="text-xs text-primary-600 hover:underline">{{ $t('notifications.mark_all') }}</button>
              </div>
              <div class="px-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <select v-model="notifStore.filterType" @change="notifStore.fetchNotifications()" class="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1">
                  <option value="">{{ $t('common.all') || 'Все' }}</option>
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
              <div v-if="notifStore.loading" class="p-4 text-center text-sm text-slate-500">{{ $t('common.loading') }}</div>
              <div v-else-if="notifStore.items.length === 0" class="p-4 text-center text-sm text-slate-500">
                <p class="mb-2">{{ $t('notifications.empty') }}</p>
                <button v-if="notifStore.unreadCount > 0" @click="notifStore.markAllRead()" class="text-xs text-primary-600 hover:underline">{{ $t('notifications.mark_all') }}</button>
              </div>
              <div v-else class="divide-y divide-slate-100 dark:divide-slate-800">
                <div v-for="n in notifStore.items" :key="n.id" class="p-3 flex gap-3 items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" @click="openNotif(n)">
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
            <button @click="showGithubMenu = !showGithubMenu" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative">
              <Icon name="github" class="w-5 h-5" />
              <span v-if="hasUpdate" class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <!-- Dropdown -->
            <div v-if="showGithubMenu" class="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg z-50">
              <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
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
                  class="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  @click="showGithubMenu = false"
                  @mouseenter="isHoveringIssue = true"
                  @mouseleave="isHoveringIssue = false">
                  <Icon name="alert02" class="w-5 h-5 transition-colors" :class="isHoveringIssue ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'" />
                  {{ $t('github.issue') }}
                </a>
                <a href="https://github.com/John710/finapp" target="_blank" rel="noopener noreferrer"
                  class="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  @click="showGithubMenu = false"
                  @mouseenter="isHoveringStar = true"
                  @mouseleave="isHoveringStar = false">
                  <Icon name="star" class="w-5 h-5 transition-colors" :class="isHoveringStar ? 'text-yellow-500' : 'text-slate-500 dark:text-slate-400'" />
                  {{ $t('github.star') }}
                </a>
              </div>
            </div>
          </div>
          <button @click="toggleTheme" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <Icon v-if="isDark" name="sun" class="w-5 h-5" />
            <Icon v-else name="moon" class="w-5 h-5" />
          </button>
        </div>
      </header>

      <!-- Page content -->
      <div class="p-4 lg:p-8 max-w-7xl mx-auto">
        <router-view />
      </div>
    </main>

    <!-- Bottom nav (mobile) -->
    <nav class="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 z-50 flex justify-around py-2">
      <router-link v-for="item in mobileNavItems" :key="item.name" :to="item.path"
        class="flex flex-col items-center gap-0.5 p-2 text-xs transition-colors"
        :class="$route.path === item.path ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-400'">
        <Icon :name="item.icon" :class="item.iconClass" />
        <span>{{ $t(item.labelKey) }}</span>
      </router-link>
    </nav>

    <!-- Undo toast -->
    <transition name="slide-up">
      <div v-if="undo.toast.value" class="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-3 rounded-xl shadow-xl flex items-center gap-4 text-sm">
        <span>{{ undo.toast.value.message }}</span>
        <button @click="undo.undo()" class="font-semibold text-primary-400 dark:text-primary-600 hover:underline">{{ $t('common.undo') }}</button>
        <button @click="undo.dismiss()" class="text-slate-400 dark:text-slate-500 hover:text-white dark:hover:text-slate-900">
          <Icon name="cancel" class="w-4 h-4" />
        </button>
      </div>
    </transition>

    <CommandPalette v-model="showCommandPalette" />
    <HelpModal v-model="showHelp" />
    <ToastContainer />
    <ConfirmModal ref="confirmModalRef" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useNotificationsStore } from '../stores/notifications'
import { useUndo } from '@/composables/useUndo'
import { useToast } from '@/composables/useToast'
import CommandPalette from '@/components/CommandPalette.vue'
import HelpModal from '@/components/HelpModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import packageJson from '../../package.json'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const notifStore = useNotificationsStore()
const undo = useUndo()
const { t } = useI18n()

const currentVersion = packageJson.version
const latestVersion = ref('')
const checkingUpdates = ref(false)
const hasUpdate = ref(false)

const showCommandPalette = ref(false)
const showHelp = ref(false)
const confirmModalRef = ref(null)

const isDark = ref(document.documentElement.classList.contains('dark'))
const showNotifs = ref(false)
const showGithubMenu = ref(false)
const isHoveringIssue = ref(false)
const isHoveringStar = ref(false)
const notifDropdownRef = ref(null)
const githubDropdownRef = ref(null)

// Global toast & confirm for views
const toast = useToast()
if (typeof window !== 'undefined') {
  window.$toast = toast
  window.$confirm = (opts) => confirmModalRef.value?.open(opts)
}

// Global hotkeys — use window listener for reliability across layouts
function onGlobalKeydown(e) {
  // Ctrl+Shift+K или Ctrl+Shift+л → Command palette
  if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'л')) {
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
  // Ctrl+Shift+N или Ctrl+Shift+т → New transaction
  if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'т')) {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('open-transaction-modal'))
    return
  }
}

function onDocClick(e) {
  if (showNotifs.value && notifDropdownRef.value && !notifDropdownRef.value.contains(e.target)) {
    showNotifs.value = false
  }
  if (showGithubMenu.value && githubDropdownRef.value && !githubDropdownRef.value.contains(e.target)) {
    showGithubMenu.value = false
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
      // Compare versions
      const current = currentVersion.split('.').map(Number)
      const latest = tag.split('.').map(Number)
      for (let i = 0; i < 3; i++) {
        if (latest[i] > current[i]) {
          hasUpdate.value = true
          break
        }
        if (latest[i] < current[i]) break
      }
    }
  } catch (e) {
    console.error('Failed to check for updates:', e)
  } finally {
    checkingUpdates.value = false
  }
}

let notifPollInterval = null

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  notifStore.fetchUnreadCount()
  notifStore.fetchNotifications()
  document.addEventListener('click', onDocClick)
  checkForUpdates()
  notifPollInterval = setInterval(() => {
    notifStore.fetchUnreadCount()
  }, 60000)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('click', onDocClick)
  if (notifPollInterval) clearInterval(notifPollInterval)
})

function openNotif(n) {
  if (!n.is_read) notifStore.markRead(n.id)
  showNotifs.value = false
  if (n.data?.url) router.push(n.data.url)
}

function formatNotifDate(date) {
  return new Date(date).toLocaleDateString()
}

const pageTitle = computed(() => {
  const key = route.name?.toLowerCase()
  if (!key) return ''
  return t(`nav.${key}`)
})

function toggleTheme() {
  const root = document.documentElement
  if (root.classList.contains('dark')) {
    root.classList.remove('dark')
    localStorage.setItem('theme', 'light')
    isDark.value = false
  } else {
    root.classList.add('dark')
    localStorage.setItem('theme', 'dark')
    isDark.value = true
  }
}

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
  { path: '/', name: 'dashboard', labelKey: 'nav.dashboard', icon: 'home', iconClass: 'w-6 h-6' },
  { path: '/transactions', name: 'transactions', labelKey: 'nav.transactions', icon: 'creditCard', iconClass: 'w-6 h-6' },
  { path: '/categories', name: 'categories', labelKey: 'nav.categories', icon: 'folder', iconClass: 'w-6 h-6' },
  { path: '/recurring', name: 'recurring', labelKey: 'nav.recurring', icon: 'repeat', iconClass: 'w-6 h-6' },
  { path: '/tags', name: 'tags', labelKey: 'nav.tags', icon: 'tag', iconClass: 'w-6 h-6' },
  { path: '/settings', name: 'settings', labelKey: 'nav.settings', icon: 'settings', iconClass: 'w-6 h-6' }
]
</script>
