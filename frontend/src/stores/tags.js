import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useTagsStore = defineStore('tags', () => {
  const tags = ref([])
  const loading = ref(false)

  async function fetchTags() {
    loading.value = true
    try {
      tags.value = await api('/tags')
    } finally {
      loading.value = false
    }
  }

  async function createTag(data) {
    const tag = await api('/tags', { method: 'POST', body: JSON.stringify(data) })
    tags.value.push(tag)
    return tag
  }

  async function updateTag(id, data) {
    const tag = await api(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = tags.value.findIndex(t => t.id === id)
    if (idx !== -1) tags.value[idx] = tag
    return tag
  }

  async function deleteTag(id) {
    await api(`/tags/${id}`, { method: 'DELETE' })
    tags.value = tags.value.filter(t => t.id !== id)
  }

  return { tags, loading, fetchTags, createTag, updateTag, deleteTag }
})
