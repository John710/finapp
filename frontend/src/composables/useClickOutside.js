import { onMounted, onBeforeUnmount } from 'vue'

export function useClickOutside(refs, callback) {
  const elements = Array.isArray(refs) ? refs : [refs]

  function handler(event) {
    const targets = elements
      .map(r => (typeof r === 'function' ? r() : r?.value))
      .filter(Boolean)

    if (targets.length === 0) return
    if (targets.some(el => el.contains(event.target))) return

    callback(event)
  }

  onMounted(() => {
    document.addEventListener('click', handler)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handler)
  })
}
