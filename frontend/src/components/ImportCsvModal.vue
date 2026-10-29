<template>
  <BaseModal :model-value="modelValue" width-class="max-w-2xl" z-class="z-50" @update:model-value="$emit('update:modelValue', $event)">
    <div class="max-h-[90vh] overflow-y-auto">
      <h2 class="font-display text-xl font-semibold mb-4">{{ $t('import.title') }}</h2>

      <!-- Profile selector -->
      <div class="mb-4">
        <label :for="`${uid}-profile`" class="block text-sm font-medium mb-1">{{ $t('import.profile') }}</label>
        <select :id="`${uid}-profile`" v-model="profile" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm" @change="onProfileChange">
          <option v-for="p in profiles" :key="p.key" :value="p.key">{{ p.name }}</option>
        </select>
      </div>

      <!-- File upload -->
      <div class="mb-4">
        <label :for="`${uid}-file`" class="block text-sm font-medium mb-1">{{ $t('import.file') }}</label>
        <input :id="`${uid}-file`" ref="fileInput" type="file" accept=".csv" class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" @change="onFileChange" />
      </div>

      <!-- Delimiter -->
      <div class="mb-4">
        <label :for="`${uid}-delimiter`" class="block text-sm font-medium mb-1">{{ $t('import.delimiter') }}</label>
        <select :id="`${uid}-delimiter`" v-model="delimiter" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm">
          <option value=";">;</option>
          <option value=",">,</option>
          <option :value="'\t'">{{ $t('import.delimiter_tab') }}</option>
        </select>
      </div>

      <!-- Date format -->
      <div class="mb-4">
        <label :for="`${uid}-date-format`" class="block text-sm font-medium mb-1">{{ $t('import.date_format') }}</label>
        <select :id="`${uid}-date-format`" v-model="dateFormat" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm">
          <option v-for="f in DATE_FORMATS" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>

      <!-- Preview -->
      <div v-if="preview.length" class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ $t('import.preview') }}</label>
        <div class="overflow-x-auto border-0 bg-slate-100 dark:bg-slate-800 rounded-lg">
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
          <label :for="`${uid}-map-${key}`" class="block text-xs text-slate-500 mb-1">{{ label }}</label>
          <select :id="`${uid}-map-${key}`" v-model="mapping[key]" class="w-full px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm">
            <option :value="null">—</option>
            <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
      </div>

      <!-- Result -->
      <div v-if="result" class="mb-4 p-3 rounded-lg" :class="result.stats?.errors?.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'">
        <p class="font-medium">{{ $t('import.created') }}: {{ result.stats.created }} / {{ result.total }}</p>
        <p v-if="result.stats.skipped">{{ $t('import.skipped') }}: {{ result.stats.skipped }}</p>
        <p v-if="result.stats.uncategorized">{{ $t('import.uncategorized') }}: {{ result.stats.uncategorized }}</p>
        <details v-if="result.stats.errors?.length" open>
          <summary class="cursor-pointer">{{ $t('import.errors') }} ({{ result.stats.errors.length }})</summary>
          <ul class="mt-1 text-xs space-y-1 max-h-48 overflow-y-auto">
            <li v-for="(err, i) in result.stats.errors.slice(0, MAX_SHOWN_ERRORS)" :key="i">{{ $t('import.row', { row: err.row }) }}: {{ err.error }}</li>
            <li v-if="result.stats.errors.length > MAX_SHOWN_ERRORS">{{ $t('import.errors_more', { count: result.stats.errors.length - MAX_SHOWN_ERRORS }) }}</li>
          </ul>
        </details>
      </div>

      <div class="flex gap-3">
        <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="close">{{ $t('common.cancel') }}</button>
        <button :disabled="!file" class="px-4 py-2.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" @click="previewFile">{{ $t('import.preview_btn') }}</button>
        <button :disabled="!file || importing" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card disabled:opacity-50 text-white text-sm font-medium" @click="importFile">
          {{ importing ? $t('common.loading') : $t('import.import_btn') }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<script setup>
import { ref, watch, computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'
import BaseModal from '@/components/BaseModal.vue'

const { t } = useI18n()
const uid = useId()

// Same list the server accepts; anything else is rejected with a 400
const DATE_FORMATS = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']
const MAX_SHOWN_ERRORS = 100

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'imported'])

const fileInput = ref(null)
const file = ref(null)
const profiles = ref([])
const profile = ref('default')
const delimiter = ref(';')
const dateFormat = ref(DATE_FORMATS[0])
const preview = ref([])
const headers = ref([])
const mapping = ref({ date: null, amount: null, type: null, category: null, account: null, note: null, currency: null })
const result = ref(null)
const importing = ref(false)

const mappingLabels = computed(() => ({
  date: t('import.fields.date'),
  amount: t('import.fields.amount'),
  type: t('import.fields.type'),
  category: t('import.fields.category'),
  account: t('import.fields.account'),
  note: t('import.fields.note'),
  currency: t('import.fields.currency')
}))

watch(() => props.modelValue, async (val) => {
  if (val) {
    try {
      profiles.value = await api('/import/profiles')
    } catch (e) {
      window.$toast?.error(e.message || t('import.failed'))
    }
    reset()
    onProfileChange()
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
  if (!p) return
  delimiter.value = p.delimiter
  if (DATE_FORMATS.includes(p.dateFormat)) dateFormat.value = p.dateFormat
}

async function previewFile() {
  if (!file.value) return
  await upload({ previewOnly: true })
}

async function importFile() {
  if (!file.value || importing.value) return
  importing.value = true
  try {
    // Refresh the parent list only when the import actually went through
    if (await upload({ previewOnly: false })) emit('imported')
  } finally {
    importing.value = false
  }
}

// Returns true when the request succeeded
async function upload(opts) {
  const formData = new FormData()
  // Multipart parsers stream fields in order: `options` must precede `file`
  // so the server has the options by the time it reads the file part
  formData.append('options', JSON.stringify({
    profile: profile.value,
    delimiter: delimiter.value,
    dateFormat: dateFormat.value,
    mapping: mapping.value,
    previewOnly: opts.previewOnly
  }))
  formData.append('file', file.value)

  try {
    // api() handles 401/refresh for the multipart upload too (raw fetch did not)
    const data = await api('/import/csv', { method: 'POST', body: formData })

    if (opts.previewOnly) {
      preview.value = data.preview
      headers.value = data.headers
    } else {
      result.value = data
      window.$toast?.success(t('import.completed'))
    }
    return true
  } catch (e) {
    window.$toast?.error(e.message || t('import.failed'))
    return false
  }
}
</script>
