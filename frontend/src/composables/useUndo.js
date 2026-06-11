import { ref } from 'vue'

const undoStack = ref([])
const toast = ref(null)
let toastTimeout = null

export function useUndo() {
  function push({ message, action }) {
    const id = Date.now()
    undoStack.value.push({ id, action })
    showToast(message)
    if (toastTimeout) clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => {
      undoStack.value = undoStack.value.filter(u => u.id !== id)
      toast.value = null
    }, 5000)
  }

  function showToast(message) {
    toast.value = { message }
  }

  function undo() {
    const item = undoStack.value.pop()
    if (item) {
      item.action()
      toast.value = null
    }
  }

  function dismiss() {
    toast.value = null
    undoStack.value = []
  }

  return { toast, push, undo, dismiss }
}
