import { ref, onMounted, onUnmounted } from 'vue'

export function useDarkMode() {
  const isDark = ref(false)
  let themeObserver = null

  onMounted(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    isDark.value = root.classList.contains('dark')
    themeObserver = new MutationObserver(() => {
      isDark.value = root.classList.contains('dark')
    })
    themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ['class']
    })
  })

  onUnmounted(() => {
    themeObserver?.disconnect()
  })

  return { isDark }
}
