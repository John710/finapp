import { onMounted, onUnmounted } from 'vue'

function parseCombo(combo) {
  const parts = combo.toLowerCase().split('+').map(p => p.trim())
  return {
    ctrl: parts.includes('ctrl') || parts.includes('cmd') || parts.includes('command'),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift'),
    key: parts.find(p => !['ctrl', 'cmd', 'command', 'alt', 'option', 'shift'].includes(p)) || ''
  }
}

function matches(e, parsed) {
  const ctrl = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  const code = e.code.toLowerCase()

  if (parsed.ctrl !== ctrl) return false
  if (parsed.alt !== e.altKey) return false
  if (parsed.shift !== e.shiftKey) return false

  // Support both key names and special codes
  const expected = parsed.key
  if (expected === 'enter' && key === 'enter') return true
  if (expected === 'esc' && key === 'escape') return true
  if (expected === 'space' && (key === ' ' || key === 'space')) return true
  if (expected === 'tab' && key === 'tab') return true
  if (expected === 'backspace' && key === 'backspace') return true
  if (expected === 'delete' && key === 'delete') return true
  if (expected === 'up' && key === 'arrowup') return true
  if (expected === 'down' && key === 'arrowdown') return true
  if (expected === 'left' && key === 'arrowleft') return true
  if (expected === 'right' && key === 'arrowright') return true
  if (key === expected) return true
  if (code === `key${expected.toUpperCase()}`) return true
  if (code === `digit${expected}`) return true
  return false
}

export function useHotkeys(handlers, options = {}) {
  const { target = window, preventDefault = true } = options

  const parsedHandlers = Object.entries(handlers).map(([combo, fn]) => ({
    parsed: parseCombo(combo),
    fn
  }))

  function onKeydown(e) {
    // Skip if user is typing in an input, textarea, or contenteditable
    const tag = e.target?.tagName?.toLowerCase()
    const isEditable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable

    for (const { parsed, fn } of parsedHandlers) {
      if (!matches(e, parsed)) continue

      // Allow '?' and 'esc' even in inputs, skip others
      if (isEditable && parsed.key !== '?' && parsed.key !== 'escape' && parsed.key !== 'esc') {
        // Still allow ctrl+enter in inputs
        if (!(parsed.ctrl && parsed.key === 'enter')) continue
      }

      if (preventDefault) e.preventDefault()
      fn(e)
      return
    }
  }

  onMounted(() => target.addEventListener('keydown', onKeydown))
  onUnmounted(() => target.removeEventListener('keydown', onKeydown))
}
