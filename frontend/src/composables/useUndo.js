import { ref, computed } from 'vue'

const undoStack = ref([])
const timeouts = new Map()

function removeEntry(id) {
  undoStack.value = undoStack.value.filter(item => item.id !== id)
  timeouts.delete(id)
}

export function useUndo(scope = 'global') {
  function push({ message, action }) {
    const id = Date.now() + Math.random()
    const entry = { id, scope, message, action }
    undoStack.value.push(entry)
    timeouts.set(
      id,
      setTimeout(() => removeEntry(id), 5000)
    )
  }

  const toast = computed(() => {
    const last = undoStack.value.filter(item => item.scope === scope).at(-1)
    return last ? { message: last.message } : null
  })

  function undo() {
    const idx = undoStack.value.findLastIndex(item => item.scope === scope)
    if (idx === -1) return
    const [item] = undoStack.value.splice(idx, 1)
    if (timeouts.has(item.id)) {
      clearTimeout(timeouts.get(item.id))
      timeouts.delete(item.id)
    }
    item.action()
  }

  function dismiss() {
    const ids = undoStack.value
      .filter(item => item.scope === scope)
      .map(item => item.id)

    ids.forEach(id => {
      if (timeouts.has(id)) {
        clearTimeout(timeouts.get(id))
        timeouts.delete(id)
      }
    })

    undoStack.value = undoStack.value.filter(item => item.scope !== scope)
  }

  return { toast, push, undo, dismiss }
}
