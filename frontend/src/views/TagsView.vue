<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('tags.title') }}</h1>
      <button class="px-4 py-2 bg-primary-500 hover:bg-primary-600 shadow-card text-white rounded-full text-sm font-medium transition-colors" @click="openModal()">
        {{ $t('tags.add') }}
      </button>
    </div>

    <div v-if="tagsStore.loading" class="text-center py-12">
      <p class="text-slate-500">{{ $t('common.loading') }}</p>
    </div>

    <div v-else-if="tagsStore.tags.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
        <Icon name="tag" class="w-8 h-8 text-slate-400" />
      </div>
      <h3 class="text-lg font-semibold mb-2">{{ $t('tags.empty') }}</h3>
      <p class="text-slate-500">{{ $t('tags.empty_desc') }}</p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="tag in tagsStore.tags" :key="tag.id" role="link" tabindex="0" :aria-label="tag.name" class="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-card dark:shadow-card-dark flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" @click="goToTransactions(tag.id)" @keydown.enter.self="goToTransactions(tag.id)" @keydown.space.self.prevent="goToTransactions(tag.id)">
        <div class="flex items-center gap-3">
          <div class="w-4 h-4 rounded-full" :style="{ backgroundColor: tag.color || '#94a3b8' }"></div>
          <span class="font-medium">{{ tag.name }}</span>
          <span class="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full">{{ tag.transaction_count ?? 0 }}</span>
        </div>
        <div v-if="isAdmin" class="flex items-center gap-1" @click.stop>
          <button class="p-1.5 text-slate-400 hover:text-primary-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" :aria-label="$t('common.edit')" @click="openModal(tag)">
            <Icon name="edit" class="w-4 h-4" />
          </button>
          <button :disabled="deletingId === tag.id" :aria-label="$t('common.delete')" class="p-1.5 text-slate-400 hover:text-danger-500 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50" @click="deleteTag(tag.id)">
            <Icon name="delete" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <BaseModal v-model="showModal" width-class="max-w-sm">
        <h3 class="text-lg font-semibold mb-4">{{ editingTag ? $t('tags.edit') : $t('tags.add') }}</h3>
        <div class="space-y-4">
          <div>
            <label :for="`${uid}-name`" class="block text-sm font-medium mb-1">{{ $t('tags.name') }}</label>
            <input :id="`${uid}-name`" v-model="form.name" type="text" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm" :placeholder="$t('tags.name')" />
          </div>
          <div>
            <span :id="`${uid}-color`" class="block text-sm font-medium mb-1">{{ $t('tags.color') }}</span>
            <div class="flex flex-wrap gap-2" role="group" :aria-labelledby="`${uid}-color`">
              <button v-for="c in colors" :key="c" type="button" :aria-label="c" :aria-pressed="form.color === c" class="w-6 h-6 rounded-full border-2 transition-all" :style="{ backgroundColor: c, borderColor: form.color === c ? c : 'transparent' }" :class="form.color === c ? 'scale-110 ring-2 ring-offset-1 ring-slate-300 dark:ring-slate-600' : ''" @click="form.color = c"></button>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button :disabled="saving" class="px-4 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm disabled:opacity-50" @click="showModal = false">{{ $t('common.cancel') }}</button>
          <button :disabled="saving || !form.name.trim()" class="px-4 py-2 bg-primary-500 hover:bg-primary-600 shadow-card disabled:opacity-50 text-white rounded-full text-sm font-medium" @click="saveTag">
            {{ saving ? $t('common.loading') : $t('common.save') }}
          </button>
        </div>
      </BaseModal>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/BaseModal.vue'
import { useRouter } from 'vue-router'
import { useTagsStore } from '../stores/tags'
import { useAuthStore } from '../stores/auth'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'

const { t } = useI18n()
const uid = useId()
const router = useRouter()
const undo = useUndo('tags')
const tagsStore = useTagsStore()
const authStore = useAuthStore()

// Tags are shared by every user: only an admin may edit or delete them
const isAdmin = computed(() => authStore.user?.role === 'admin')

useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveTag() },
  'esc': () => { if (showModal.value) closeModal() }
})

const showModal = ref(false)
const editingTag = ref(null)
const saving = ref(false)
const deletingId = ref(null)
const form = ref({ name: '', color: '#7c6fde' })

const colors = ['#7c6fde', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#f43f5e', '#ec4899', '#6366f1', '#14b8a6', '#84cc16']

onMounted(() => tagsStore.fetchTags())

function openModal(tag = null) {
  editingTag.value = tag
  form.value = tag ? { name: tag.name, color: tag.color || '#7c6fde' } : { name: '', color: '#7c6fde' }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

async function saveTag() {
  const name = form.value.name.trim()
  if (!name || saving.value) return
  if (editingTag.value && !isAdmin.value) return
  saving.value = true
  try {
    if (editingTag.value) {
      await tagsStore.updateTag(editingTag.value.id, { name, color: form.value.color })
    } else {
      await tagsStore.createTag({ name, color: form.value.color })
    }
    closeModal()
  } catch (e) {
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

function goToTransactions(tagId) {
  router.push({ path: '/transactions', query: { tag_id: tagId } })
}

async function deleteTag(id) {
  if (!isAdmin.value || deletingId.value !== null) return
  if (!(await window.$confirm({ message: t('common.confirm_delete'), danger: true }))) return
  const item = tagsStore.tags.find(t => t.id === id)
  deletingId.value = id
  try {
    await tagsStore.deleteTag(id)
    if (item) {
      undo.push({
        message: t('common.undo_delete'),
        action: async () => {
          try {
            await tagsStore.createTag({ name: item.name, color: item.color })
          } catch (e) {
            window.$toast?.error(e.message || t('common.error'))
          }
        }
      })
    }
  } catch (e) {
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    deletingId.value = null
  }
}
</script>
