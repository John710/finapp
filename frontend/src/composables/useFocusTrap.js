import { ref, onMounted, onUnmounted, watch } from 'vue'

const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export function useFocusTrap(containerRef, activeRef) {
  const previousActiveElement = ref(null)

  function getFocusable() {
    const container = containerRef.value
    if (!container) return []
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS))
      .filter(el => el.offsetParent !== null)
  }

  function handleKeydown(e) {
    if (e.key !== 'Tab') return
    const focusable = getFocusable()
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus()
        e.preventDefault()
      }
    } else {
      if (document.activeElement === last) {
        first.focus()
        e.preventDefault()
      }
    }
  }

  function lockBody() {
    const body = document.body
    body.style.overflow = 'hidden'
  }

  function unlockBody() {
    const body = document.body
    body.style.overflow = ''
  }

  function activate() {
    previousActiveElement.value = document.activeElement
    lockBody()
    const focusable = getFocusable()
    if (focusable.length > 0) {
      focusable[0].focus()
    }
    document.addEventListener('keydown', handleKeydown)
  }

  function deactivate() {
    document.removeEventListener('keydown', handleKeydown)
    unlockBody()
    if (previousActiveElement.value?.focus) {
      previousActiveElement.value.focus()
    }
  }

  onMounted(() => {
    watch(activeRef, (active) => {
      if (active) {
        // Wait for DOM to render
        requestAnimationFrame(activate)
      } else {
        deactivate()
      }
    }, { immediate: true })
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
    unlockBody()
  })
}
