import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/api'

export const useCategoriesStore = defineStore('categories', () => {
  const categories = ref([])
  const loading = ref(false)

  async function fetchCategories() {
    loading.value = true
    categories.value = await api('/categories')
    loading.value = false
  }

  async function createCategory(data) {
    const category = await api('/categories', { method: 'POST', body: JSON.stringify(data) })
    categories.value.push(category)
    return category
  }

  async function updateCategory(id, data) {
    const category = await api(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    const idx = categories.value.findIndex(c => c.id === id)
    if (idx !== -1) categories.value[idx] = category
    return category
  }

  async function deleteCategory(id) {
    await api(`/categories/${id}`, { method: 'DELETE' })
    categories.value = categories.value.filter(c => c.id !== id)
  }

  return { categories, loading, fetchCategories, createCategory, updateCategory, deleteCategory }
})
