import { ref, onMounted, onUnmounted, watch, toValue } from 'vue'

const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

// Modals can stack (e.g. a quick-create modal over a form modal). Body scroll
// stays locked while any trap is active, and only the top-most trap handles Tab.
const activeTraps = []

function lockBody() {
  document.body.style.overflow = 'hidden'
}

function unlockBody() {
  if (activeTraps.length === 0) document.body.style.overflow = ''
}

export function useFocusTrap(containerRef, activeRef) {
  const previousActiveElement = ref(null)
  const token = {}
  let isActive = false
  let rafId = null

  function getFocusable() {
    const container = containerRef.value
    if (!container) return []
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS))
      .filter(el => el.offsetParent !== null)
  }

  function handleKeydown(e) {
    if (e.key !== 'Tab') return
    if (activeTraps[activeTraps.length - 1] !== token) return
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

  function activate() {
    rafId = null
    // The modal may have been closed again before the frame fired
    if (isActive || !toValue(activeRef)) return
    isActive = true
    previousActiveElement.value = document.activeElement
    activeTraps.push(token)
    lockBody()
    const focusable = getFocusable()
    if (focusable.length > 0) {
      focusable[0].focus()
    }
    document.addEventListener('keydown', handleKeydown)
  }

  function release() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (!isActive) return false
    isActive = false
    document.removeEventListener('keydown', handleKeydown)
    const idx = activeTraps.indexOf(token)
    if (idx !== -1) activeTraps.splice(idx, 1)
    unlockBody()
    return true
  }

  function deactivate() {
    // A modal that never opened (initial closed state) has nothing to undo
    if (!release()) return
    if (previousActiveElement.value?.focus) {
      previousActiveElement.value.focus()
    }
  }

  onMounted(() => {
    watch(activeRef, (active) => {
      if (active) {
        // Wait for DOM to render
        rafId = requestAnimationFrame(activate)
      } else {
        deactivate()
      }
    }, { immediate: true })
  })

  onUnmounted(() => {
    release()
  })
}
