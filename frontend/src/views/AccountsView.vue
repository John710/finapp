<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ $t('accounts.title') }}</h1>
      <button @click="openModal()" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
        <Icon name="plus" class="w-4 h-4" />
        {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="accountsStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="accountsStore.accounts.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <p class="text-slate-500">{{ $t('accounts.empty') }}</p>
    </div>

    <div v-else class="space-y-8">
      <!-- Regular -->
      <div v-if="regularAccounts.length">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{{ $t('accounts.regular_title') }}</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div v-for="account in regularAccounts" :key="account.id"
            class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden cursor-pointer"
            :class="{
              'opacity-60': account.is_archived,
              'ring-2 ring-primary-300 translate-y-1': dragOverId === account.id && dragOverPosition === 'after',
              'ring-2 ring-primary-300 -translate-y-1': dragOverId === account.id && dragOverPosition === 'before'
            }"
            @dragover.prevent="onDragOver($event, account)"
            @drop="onDrop($event, account)"
            @click="$router.push(`/accounts/${account.id}`)">
            <div class="absolute top-0 right-0 w-24 h-24 rounded-bl-full" :style="{ backgroundColor: account.color + '10' }"></div>
            <div class="absolute top-2 right-2 z-10 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing"
              draggable="true"
              @dragstart="onDragStart($event, account)"
              @dragend="onDragEnd"
              @click.stop>
              <svg class="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/>
                <circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
              </svg>
            </div>
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white" :style="{ backgroundColor: account.color || '#64748b' }">
                <svg v-if="account.type" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-html="typeIcon(account.type)"></svg>
              </div>
              <div>
                <p class="font-semibold">{{ account.name }}</p>
                <p class="text-xs text-slate-500">{{ $t('accounts.types.' + account.type) }} • {{ account.currency }}</p>
              </div>
            </div>
            <p class="text-2xl font-bold">{{ formatCurrency(account.balance, account.currency) }}</p>
            <div class="mt-4 flex gap-2">
              <button @click.stop="editAccount(account)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">{{ $t('common.edit') }}</button>
              <button @click.stop="deleteAccount(account.id)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors">{{ $t('common.delete') }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Crypto -->
      <div v-if="cryptoAccounts.length">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{{ $t('accounts.crypto_title') }}</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div v-for="account in cryptoAccounts" :key="account.id"
            class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden cursor-pointer"
            :class="{
              'opacity-60': account.is_archived,
              'ring-2 ring-primary-300 translate-y-1': dragOverId === account.id && dragOverPosition === 'after',
              'ring-2 ring-primary-300 -translate-y-1': dragOverId === account.id && dragOverPosition === 'before'
            }"
            @dragover.prevent="onDragOver($event, account)"
            @drop="onDrop($event, account)"
            @click="$router.push(`/accounts/${account.id}`)">
            <div class="absolute top-0 right-0 w-24 h-24 rounded-bl-full" :style="{ backgroundColor: account.color + '10' }"></div>
            <div class="absolute top-2 right-2 z-10 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing"
              draggable="true"
              @dragstart="onDragStart($event, account)"
              @dragend="onDragEnd"
              @click.stop>
              <svg class="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/>
                <circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
              </svg>
            </div>
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white" :style="{ backgroundColor: account.color || '#64748b' }">
                <svg v-if="account.type" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-html="typeIcon(account.type)"></svg>
              </div>
              <div>
                <p class="font-semibold">{{ account.name }}</p>
                <p class="text-xs text-slate-500">{{ account.currency }}</p>
              </div>
            </div>
            <div>
              <p class="text-2xl font-bold font-mono">{{ formatCryptoBalance(account.balance) }} <span class="text-sm font-normal text-slate-500">{{ account.currency }}</span></p>
              <p v-if="cryptoValue(account)" class="text-sm text-slate-500 mt-1">≈ {{ formatCurrency(cryptoValue(account), baseCurrency) }}</p>
            </div>
            <div class="mt-4 flex gap-2">
              <button @click.stop="editAccount(account)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">{{ $t('common.edit') }}</button>
              <button @click.stop="deleteAccount(account.id)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors">{{ $t('common.delete') }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Goals -->
      <div v-if="goalAccounts.length">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{{ $t('accounts.goals_title') }}</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div v-for="account in goalAccounts" :key="account.id"
            class="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden cursor-pointer"
            :class="{
              'opacity-60': account.is_archived,
              'ring-2 ring-primary-300 translate-y-1': dragOverId === account.id && dragOverPosition === 'after',
              'ring-2 ring-primary-300 -translate-y-1': dragOverId === account.id && dragOverPosition === 'before'
            }"
            @dragover.prevent="onDragOver($event, account)"
            @drop="onDrop($event, account)"
            @click="$router.push(`/accounts/${account.id}`)">
            <div class="absolute top-0 right-0 w-24 h-24 rounded-bl-full" :style="{ backgroundColor: account.color + '10' }"></div>
            <div class="absolute top-2 right-2 z-10 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing"
              draggable="true"
              @dragstart="onDragStart($event, account)"
              @dragend="onDragEnd"
              @click.stop>
              <svg class="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/>
                <circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
              </svg>
            </div>
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white" :style="{ backgroundColor: account.color || '#64748b' }">
                <svg v-if="account.type" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-html="typeIcon(account.type)"></svg>
              </div>
              <div>
                <p class="font-semibold">{{ account.name }}</p>
                <p class="text-xs text-slate-500">{{ $t('accounts.types.' + account.type) }}</p>
              </div>
            </div>
            <div class="mb-2">
              <div class="flex justify-between text-sm mb-1">
                <span class="font-bold">{{ formatCurrency(account.balance, account.currency) }}</span>
                <span class="text-slate-500">{{ $t('accounts.of') }} {{ formatCurrency(account.target_amount, account.currency) }}</span>
              </div>
              <div class="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" :class="goalBarColor(account)" :style="{ width: Math.min(goalProgress(account), 100) + '%' }"></div>
              </div>
              <p class="text-xs mt-1 text-slate-500">{{ goalProgress(account) }}% {{ $t('accounts.completed') }}</p>
            </div>
            <div class="mt-3 flex gap-2">
              <button @click.stop="editAccount(account)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">{{ $t('common.edit') }}</button>
              <button @click.stop="deleteAccount(account.id)" class="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-danger-50 dark:hover:bg-danger-900/20 text-danger-500 transition-colors">{{ $t('common.delete') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 relative z-10 max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold mb-4">{{ isEditing ? $t('common.edit') : $t('common.add') }}</h2>
        <form @submit.prevent="saveAccount" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.name') }}</label>
            <input v-model="form.name" required class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
              <select v-model="form.type" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                <option value="card">{{ $t('accounts.types.card') }}</option>
                <option value="cash">{{ $t('accounts.types.cash') }}</option>
                <option value="crypto">{{ $t('accounts.types.crypto') }}</option>
                <option value="other">{{ $t('accounts.types.other') }}</option>
                <option value="goal">{{ $t('accounts.types.goal') }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('common.currency') }}</label>
              <div v-if="form.type === 'crypto'" class="relative" ref="cryptoSelectRef">
                <button type="button" @click="showCryptoDropdown = !showCryptoDropdown" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left text-sm flex items-center justify-between">
                  <span v-if="form.currency">{{ form.currency }} — {{ cryptoList.find(c => c.symbol === form.currency)?.name || '' }}</span>
                  <span v-else class="text-slate-400">{{ $t('common.search') }}...</span>
                  <Icon name="arrowDown" class="w-4 h-4 text-slate-400" />
                </button>
                <div v-if="showCryptoDropdown" class="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg max-h-60 overflow-hidden flex flex-col">
                  <div class="p-2 border-b border-slate-100 dark:border-slate-800">
                    <input v-model="cryptoSearch" type="text" :placeholder="$t('common.search')" class="w-full px-2 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" @keydown="onCryptoKeydown" ref="cryptoSearchInput" />
                  </div>
                  <div class="overflow-y-auto flex-1">
                    <button v-for="c in filteredCryptoList" :key="c.symbol" type="button" @click="selectCrypto(c)"
                      class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                      :class="form.currency === c.symbol ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600' : ''">
                      <img v-if="c.image && !imgError.has(c.symbol)" :src="c.image" class="w-5 h-5 rounded-full" @error="imgError.add(c.symbol)" />
                      <div v-else class="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ c.symbol?.[0] || '?' }}</div>
                      <span class="font-medium">{{ c.symbol }}</span>
                      <span class="text-slate-500">{{ c.name }}</span>
                    </button>
                    <div v-if="filteredCryptoList.length === 0" class="px-3 py-4 text-sm text-slate-500 text-center">{{ $t('common.empty') }}</div>
                  </div>
                </div>
              </div>
              <CurrencySelect v-else v-model="form.currency" required
                :placeholder="$t('common.currency')"
                :search-placeholder="$t('common.search')"
                :empty-text="$t('common.empty')" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ form.type === 'crypto' ? $t('accounts.coin_amount') : $t('accounts.initial_balance') }}</label>
            <input v-model.number="form.balance" type="number" :step="form.type === 'crypto' ? '0.00000001' : '0.01'" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div v-if="form.type === 'goal'">
            <label class="block text-sm font-medium mb-1">{{ $t('accounts.target_amount') }}</label>
            <input v-model.number="form.target_amount" type="number" step="0.01" required class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('accounts.color') }}</label>
            <div class="flex flex-wrap gap-2">
              <button v-for="color in presetColors" :key="color" type="button" @click="form.color = color"
                class="w-8 h-8 rounded-full transition-all"
                :class="form.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-slate-900' : ''"
                :style="{ backgroundColor: color, ringColor: color }"></button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" @click="closeModal" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, reactive, computed, watch, nextTick } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { useRatesStore } from '../stores/rates'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import { api } from '@/utils/api'
import CurrencySelect from '../components/CurrencySelect.vue'

const { t } = useI18n()
const ratesStore = useRatesStore()
const undo = useUndo()

useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveAccount() },
  'esc': () => { if (showModal.value) closeModal() }
})

const presetColors = ['#f43f5e', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#f472b6', '#94a3b8']

const accountsStore = useAccountsStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const showModal = ref(false)
const isEditing = ref(false)
const form = reactive({ name: '', type: 'card', currency: baseCurrency.value, balance: 0, color: '#10b981', icon: null, target_amount: 0 })
const cryptoList = ref([])
const showCryptoDropdown = ref(false)
const cryptoSearch = ref('')
const cryptoSelectRef = ref(null)
const cryptoSearchInput = ref(null)
const imgError = reactive(new Set())
const draggingId = ref(null)
const dragOverId = ref(null)
const dragOverPosition = ref(null)

const filteredCryptoList = computed(() => {
  const q = cryptoSearch.value.toLowerCase()
  if (!q) return cryptoList.value
  return cryptoList.value.filter(c =>
    c.symbol.toLowerCase().includes(q) ||
    c.name.toLowerCase().includes(q)
  )
})

function selectCrypto(coin) {
  form.currency = coin.symbol
  showCryptoDropdown.value = false
  cryptoSearch.value = ''
}



watch(showCryptoDropdown, async (val) => {
  if (val) {
    cryptoSearch.value = ''
    await nextTick()
    cryptoSearchInput.value?.focus()
  }
})

function onCryptoKeydown(e) {
  if (e.key === 'Escape') {
    showCryptoDropdown.value = false
  }
}

function onDocClick(e) {
  if (showCryptoDropdown.value && cryptoSelectRef.value && !cryptoSelectRef.value.contains(e.target)) {
    showCryptoDropdown.value = false
  }
}

const regularAccounts = computed(() => accountsStore.accounts.filter(a => ['card', 'cash', 'other'].includes(a.type)))
const cryptoAccounts = computed(() => accountsStore.accounts.filter(a => a.type === 'crypto'))
const goalAccounts = computed(() => accountsStore.accounts.filter(a => a.type === 'goal'))

const typeIcons = {
  card: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>',
  cash: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  crypto: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
  goal: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  other: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"/>'
}

onMounted(async () => {
  accountsStore.fetchAccounts()
  ratesStore.fetchRates()
  document.addEventListener('click', onDocClick)
  try {
    cryptoList.value = await api('/currencies/crypto')
  } catch (e) {
    console.warn('Failed to load crypto list', e)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

function formatCurrency(value, currency) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(value)
}

function formatCryptoBalance(value) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(value)
}

function cryptoValue(account) {
  const converted = ratesStore.convert(parseFloat(account.balance), account.currency, baseCurrency.value)
  return converted !== null ? converted : null
}

function goalProgress(account) {
  if (!account.target_amount || parseFloat(account.target_amount) === 0) return 0
  return Math.round((parseFloat(account.balance) / parseFloat(account.target_amount)) * 100)
}

function goalBarColor(account) {
  const p = goalProgress(account)
  if (p >= 100) return 'bg-emerald-500'
  if (p >= 75) return 'bg-primary-500'
  if (p >= 50) return 'bg-warning-400'
  return 'bg-slate-400'
}

function typeIcon(type) {
  return typeIcons[type] || typeIcons.other
}

function openModal() {
  isEditing.value = false
  Object.assign(form, { name: '', type: 'card', currency: baseCurrency.value, balance: 0, color: '#10b981', icon: null, target_amount: 0 })
  showModal.value = true
}

function editAccount(account) {
  isEditing.value = true
  Object.assign(form, { ...account, target_amount: account.target_amount || 0 })
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

async function saveAccount() {
  if (isEditing.value) {
    await accountsStore.updateAccount(form.id, { ...form })
  } else {
    await accountsStore.createAccount({ ...form })
  }
  closeModal()
}

async function deleteAccount(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const acc = accountsStore.accounts.find(a => a.id === id)
  await accountsStore.deleteAccount(id)
  if (acc) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await accountsStore.createAccount({ ...acc })
      }
    })
  }
}

function onDragStart(e, account) {
  draggingId.value = account.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(account.id))

  // Use the parent card as drag image so the whole card follows the cursor
  const handle = e.target.closest('[draggable]')
  const card = handle?.closest('.cursor-pointer')
  if (card) {
    const rect = card.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    e.dataTransfer.setDragImage(card, offsetX, offsetY)
  }
}

function onDragOver(e, account) {
  if (draggingId.value === account.id) {
    dragOverId.value = null
    dragOverPosition.value = null
    return
  }
  dragOverId.value = account.id
  // Determine if dropping before or after based on mouse position within the card
  const rect = e.currentTarget.getBoundingClientRect()
  const offsetY = e.clientY - rect.top
  dragOverPosition.value = offsetY > rect.height / 2 ? 'after' : 'before'
}

function onDrop(e, targetAccount) {
  e.preventDefault()
  const sourceId = parseInt(e.dataTransfer.getData('text/plain'), 10)
  dragOverId.value = null
  dragOverPosition.value = null
  draggingId.value = null
  isDragClick.value = false

  if (!sourceId || sourceId === targetAccount.id) return
  if (!accountsStore.accounts.find(a => a.id === sourceId)) return

  // Get all accounts of the same type, sorted by current sort_order
  const sameType = accountsStore.accounts
    .filter(a => a.type === targetAccount.type)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const sourceIdx = sameType.findIndex(a => a.id === sourceId)
  const targetIdx = sameType.findIndex(a => a.id === targetAccount.id)
  if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return

  // Determine insert position based on visual feedback direction
  const rect = e.currentTarget.getBoundingClientRect()
  const offsetY = e.clientY - rect.top
  const insertAfter = offsetY > rect.height / 2

  // Move source to target position
  const [moved] = sameType.splice(sourceIdx, 1)
  const insertIdx = insertAfter ? targetIdx + 1 : targetIdx
  sameType.splice(insertIdx, 0, moved)

  // Build orders with new sequential sort_order
  const orders = sameType.map((a, idx) => ({ id: a.id, sort_order: idx }))

  // Optimistically update local state
  for (const item of orders) {
    const acc = accountsStore.accounts.find(a => a.id === item.id)
    if (acc) acc.sort_order = item.sort_order
  }

  // Call API
  accountsStore.reorderAccounts(orders).catch(err => {
    console.error('Reorder failed', err)
    window.$toast?.error(t('common.error'))
    // Refresh to restore server state
    accountsStore.fetchAccounts()
  })
}

function onDragEnd() {
  draggingId.value = null
  dragOverId.value = null
  dragOverPosition.value = null
}
</script>
