<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ $t('tags.title') }}</h1>
      <button @click="openModal()" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors">
        {{ $t('tags.add') }}
      </button>
    </div>

    <div v-if="tags.length === 0" class="bg-white dark:bg-slate-900 rounded-xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
        <Icon name="tag" class="w-8 h-8 text-slate-400" />
      </div>
      <h3 class="text-lg font-semibold mb-2">{{ $t('tags.empty') }}</h3>
      <p class="text-slate-500">{{ $t('tags.empty_desc') }}</p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="tag in tags" :key="tag.id" @click="goToTransactions(tag.id)" class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <div class="flex items-center gap-3">
          <div class="w-4 h-4 rounded-full" :style="{ backgroundColor: tag.color || '#94a3b8' }"></div>
          <span class="font-medium">{{ tag.name }}</span>
          <span class="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full">{{ tag.transaction_count ?? 0 }}</span>
        </div>
        <div class="flex items-center gap-1" @click.stop>
          <button @click="openModal(tag)" class="p-1.5 text-slate-400 hover:text-primary-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <Icon name="edit" class="w-4 h-4" />
          </button>
          <button @click="deleteTag(tag.id)" class="p-1.5 text-slate-400 hover:text-danger-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <Icon name="delete" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" @click.self="showModal = false">
      <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-sm p-6">
        <h3 class="text-lg font-semibold mb-4">{{ editingTag ? $t('tags.edit') : $t('tags.add') }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('tags.name') }}</label>
            <input v-model="form.name" type="text" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" :placeholder="$t('tags.name')" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('tags.color') }}</label>
            <div class="flex flex-wrap gap-2">
              <button v-for="c in colors" :key="c" @click="form.color = c" class="w-6 h-6 rounded-full border-2 transition-all" :style="{ backgroundColor: c, borderColor: form.color === c ? c : 'transparent' }" :class="form.color === c ? 'scale-110 ring-2 ring-offset-1 ring-slate-300 dark:ring-slate-600' : ''"></button>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button @click="showModal = false" class="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">{{ $t('common.cancel') }}</button>
          <button @click="saveTag" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium">{{ $t('common.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '@/utils/api'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'

const { t } = useI18n()
const router = useRouter()
const undo = useUndo()
useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveTag() },
  'esc': () => { if (showModal.value) closeModal() }
})
const tags = ref([])
const showModal = ref(false)
const editingTag = ref(null)
const form = ref({ name: '', color: '#0f766e' })

const colors = ['#0f766e', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#f43f5e', '#ec4899', '#6366f1', '#14b8a6', '#84cc16']

onMounted(fetchTags)

async function fetchTags() {
  tags.value = await api('/tags')
}

function openModal(tag = null) {
  editingTag.value = tag
  form.value = tag ? { name: tag.name, color: tag.color || '#0f766e' } : { name: '', color: '#0f766e' }
  showModal.value = true
}

async function saveTag() {
  if (editingTag.value) {
    await api(`/tags/${editingTag.value.id}`, { method: 'PUT', body: JSON.stringify(form.value) })
  } else {
    await api('/tags', { method: 'POST', body: JSON.stringify(form.value) })
  }
  showModal.value = false
  await fetchTags()
}

function goToTransactions(tagId) {
  router.push({ path: '/transactions', query: { tag_id: tagId } })
}

async function deleteTag(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const item = tags.value.find(t => t.id === id)
  await api(`/tags/${id}`, { method: 'DELETE' })
  await fetchTags()
  if (item) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await api('/tags', { method: 'POST', body: JSON.stringify({ name: item.name, color: item.color }) })
        await fetchTags()
      }
    })
  }
}
</script>
