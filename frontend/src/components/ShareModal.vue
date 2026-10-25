<template>
  <BaseModal v-model="model" widthClass="max-w-sm">
    <h2 class="font-display text-xl font-semibold mb-1">{{ $t('sharing.title') }}</h2>
    <p v-if="entityLabel" class="text-sm text-slate-500 mb-4 truncate">{{ entityLabel }}</p>

    <div v-if="loading" class="py-8 text-center text-sm text-slate-500">{{ $t('common.loading') }}</div>
    <div v-else class="space-y-4">
      <!-- Family -->
      <div class="flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input type="checkbox" v-model="familyEnabled" class="rounded" />
          {{ $t('sharing.family') }}
        </label>
        <select v-if="familyEnabled" v-model="familyPermission" class="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
          <option value="view">{{ $t('sharing.view') }}</option>
          <option value="edit">{{ $t('sharing.edit') }}</option>
        </select>
      </div>

      <!-- Specific users -->
      <div>
        <p class="text-sm font-medium mb-2">{{ $t('sharing.users') }}</p>
        <div v-if="userShares.length" class="space-y-2 mb-2">
          <div v-for="us in userShares" :key="us.id" class="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
            <span class="text-sm font-medium truncate">{{ us.login }}</span>
            <div class="flex items-center gap-1.5">
              <select v-model="us.permission" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border-0 text-slate-900 dark:text-slate-100 text-xs">
                <option value="view">{{ $t('sharing.view') }}</option>
                <option value="edit">{{ $t('sharing.edit') }}</option>
              </select>
              <button @click="userShares = userShares.filter(u => u.id !== us.id)" class="text-slate-400 hover:text-danger-500" :aria-label="$t('common.delete')">
                <Icon name="cancel" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <select v-model="pickedUserId" @change="addUser" class="flex-1 px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
            <option :value="null" disabled>{{ $t('sharing.pick_user') }}</option>
            <option v-for="u in addableUsers" :key="u.id" :value="u.id">{{ u.login }}</option>
          </select>
        </div>
      </div>

      <button @click="save" :disabled="saving || !!pickedUserId" class="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium disabled:opacity-40">
        {{ saving ? $t('common.loading') : $t('common.save') }}
      </button>
    </div>
  </BaseModal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'
import { logger } from '@/utils/logger.js'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  entityType: { type: String, required: true },
  entityId: { type: Number, default: null },
  entityLabel: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const { t } = useI18n()
const model = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const saving = ref(false)
const familyEnabled = ref(false)
const familyPermission = ref('edit')
const userShares = ref([])
const directory = ref([])
const pickedUserId = ref(null)

const addableUsers = computed(() => directory.value.filter(u => !userShares.value.some(us => us.id === u.id)))

watch(() => props.modelValue, async (open) => {
  if (!open || !props.entityId) return
  loading.value = true
  try {
    const [shareState, dir] = await Promise.all([
      api(`/shares/${props.entityType}/${props.entityId}`),
      api('/users/directory')
    ])
    directory.value = dir
    familyEnabled.value = Boolean(shareState.family)
    familyPermission.value = shareState.family || 'edit'
    userShares.value = shareState.users
  } catch (e) {
    logger.error('Failed to load shares', e)
    window.$toast?.error(e.message || t('common.error'))
    model.value = false
  } finally {
    loading.value = false
  }
})

function addUser() {
  const u = directory.value.find(d => d.id === pickedUserId.value)
  if (!u) return
  userShares.value.push({ id: u.id, login: u.login, permission: 'edit' })
  pickedUserId.value = null
}

async function save() {
  saving.value = true
  try {
    await api(`/shares/${props.entityType}/${props.entityId}`, {
      method: 'PUT',
      body: JSON.stringify({
        family: familyEnabled.value ? familyPermission.value : null,
        users: userShares.value.map(u => ({ id: u.id, permission: u.permission }))
      })
    })
    window.$toast?.success(t('common.saved'))
    model.value = false
    emit('saved')
  } catch (e) {
    logger.error('Failed to save shares', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}
</script>
