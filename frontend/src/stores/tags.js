import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useTagsStore = defineStore('tags', () => {
  const tags = ref([])

  async function fetchTags() {
    tags.value = await api('/tags')
  }

  async function createTag(data) {
    const tag = await api('/tags', { method: 'POST', body: JSON.stringify(data) })
    tags.value.push(tag)
    return tag
  }

  return { tags, fetchTags, createTag }
})
