<template>
  <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close"></div>
    <div class="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl p-6 relative z-10 max-h-[90vh] overflow-y-auto">
      <h2 class="text-xl font-bold mb-4">{{ $t('import.title') }}</h2>

      <!-- Profile selector -->
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ $t('import.profile') }}</label>
        <select v-model="profile" @change="onProfileChange" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm">
          <option v-for="p in profiles" :key="p.key" :value="p.key">{{ p.name }}</option>
        </select>
      </div>

      <!-- File upload -->
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ $t('import.file') }}</label>
        <input type="file" accept=".csv" @change="onFileChange" ref="fileInput" class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
      </div>

      <!-- Delimiter -->
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ $t('import.delimiter') }}</label>
        <select v-model="delimiter" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm">
          <option value=";">;</option>
          <option value=",">,</option>
          <option value="\t">Tab</option>
        </select>
      </div>

      <!-- Preview -->
      <div v-if="preview.length" class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ $t('import.preview') }}</label>
        <div class="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
          <table class="w-full text-xs">
            <thead class="bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th v-for="h in headers" :key="h" class="px-3 py-2 text-left font-medium">{{ h }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr v-for="(row, i) in preview" :key="i">
                <td v-for="h in headers" :key="h" class="px-3 py-2">{{ row[h] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Mapping -->
      <div v-if="headers.length" class="mb-4 grid grid-cols-2 gap-3">
        <div v-for="(label, key) in mappingLabels" :key="key">
          <label class="block text-xs text-slate-500 mb-1">{{ label }}</label>
          <select v-model="mapping[key]" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm">
            <option :value="null">—</option>
            <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
      </div>

      <!-- Result -->
      <div v-if="result" class="mb-4 p-3 rounded-lg" :class="result.errors?.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'">
        <p class="font-medium">{{ $t('import.created') }}: {{ result.stats.created }} / {{ result.total }}</p>
        <p v-if="result.stats.skipped">{{ $t('import.skipped') }}: {{ result.stats.skipped }}</p>
        <details v-if="result.stats.errors?.length">
          <summary class="cursor-pointer">{{ $t('import.errors') }} ({{ result.stats.errors.length }})</summary>
          <ul class="mt-1 text-xs space-y-1">
            <li v-for="(err, i) in result.stats.errors.slice(0, 10)" :key="i">{{ err.row }}: {{ err.error }}</li>
          </ul>
        </details>
      </div>

      <div class="flex gap-3">
        <button type="button" @click="close" class="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">{{ $t('common.cancel') }}</button>
        <button @click="previewFile" :disabled="!file" class="px-4 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50">{{ $t('import.preview_btn') }}</button>
        <button @click="importFile" :disabled="!file || importing" class="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium">
          {{ importing ? $t('common.loading') + '...' : $t('import.import_btn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'

const { t } = useI18n()

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'imported'])

const fileInput = ref(null)
const file = ref(null)
const profiles = ref([])
const profile = ref('default')
const delimiter = ref(';')
const preview = ref([])
const headers = ref([])
const mapping = ref({ date: null, amount: null, type: null, category: null, account: null, note: null, currency: null })
const result = ref(null)
const importing = ref(false)

const mappingLabels = {
  date: 'Дата',
  amount: 'Сумма',
  type: 'Тип',
  category: 'Категория',
  account: 'Счёт',
  note: 'Примечание',
  currency: 'Валюта'
}

watch(() => props.modelValue, async (val) => {
  if (val) {
    const data = await api('/import/profiles')
    profiles.value = data
    reset()
  }
})

function reset() {
  file.value = null
  preview.value = []
  headers.value = []
  result.value = null
  mapping.value = { date: null, amount: null, type: null, category: null, account: null, note: null, currency: null }
  if (fileInput.value) fileInput.value.value = ''
}

function close() {
  emit('update:modelValue', false)
}

function onFileChange(e) {
  file.value = e.target.files[0]
  preview.value = []
  headers.value = []
  result.value = null
}

function onProfileChange() {
  const p = profiles.value.find(p => p.key === profile.value)
  if (p) delimiter.value = p.delimiter
}

async function previewFile() {
  if (!file.value) return
  await upload({ previewOnly: true })
}

async function importFile() {
  if (!file.value) return
  importing.value = true
  await upload({ previewOnly: false })
  importing.value = false
  emit('imported')
}

async function upload(opts) {
  const formData = new FormData()
  formData.append('file', file.value)
  formData.append('options', JSON.stringify({
    profile: profile.value,
    delimiter: delimiter.value,
    mapping: mapping.value,
    previewOnly: opts.previewOnly
  }))

  const res = await fetch('/api/v1/import/csv', {
    method: 'POST',
    body: formData,
    headers: {
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`
    }
  })

  const data = await res.json()
  if (!res.ok) {
    window.$toast?.showToast(data.error || 'Import failed', 'error')
    return
  }

  if (opts.previewOnly) {
    preview.value = data.preview
    headers.value = data.headers
  } else {
    result.value = data
    window.$toast?.success(t('import.completed'))
  }
}
</script>
