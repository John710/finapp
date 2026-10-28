import { ref, computed, toValue } from 'vue'

const undoStack = ref([])
const timeouts = new Map()

function removeEntry(id) {
  undoStack.value = undoStack.value.filter(item => item.id !== id)
  timeouts.delete(id)
}

// `scope` may be a string, a ref or a getter. A reactive scope lets the layout
// (mounted once) follow the current route instead of the page that happened to
// be opened first.
export function useUndo(scope = 'global') {
  function push({ message, action }) {
    const id = Date.now() + Math.random()
    const entry = { id, scope: toValue(scope), message, action }
    undoStack.value.push(entry)
    timeouts.set(
      id,
      setTimeout(() => removeEntry(id), 5000)
    )
  }

  const toast = computed(() => {
    const current = toValue(scope)
    const last = undoStack.value.filter(item => item.scope === current).at(-1)
    return last ? { message: last.message } : null
  })

  function undo() {
    const current = toValue(scope)
    const idx = undoStack.value.findLastIndex(item => item.scope === current)
    if (idx === -1) return
    const [item] = undoStack.value.splice(idx, 1)
    if (timeouts.has(item.id)) {
      clearTimeout(timeouts.get(item.id))
      timeouts.delete(item.id)
    }
    item.action()
  }

  function dismiss() {
    const current = toValue(scope)
    const ids = undoStack.value
      .filter(item => item.scope === current)
      .map(item => item.id)

    ids.forEach(id => {
      if (timeouts.has(id)) {
        clearTimeout(timeouts.get(id))
        timeouts.delete(id)
      }
    })

    undoStack.value = undoStack.value.filter(item => item.scope !== current)
  }

  return { toast, push, undo, dismiss }
}
