import { reactive } from 'vue'

const toasts = reactive([])
let id = 0

export function useToast() {
  function push(message, type = 'info', duration = 4000) {
    const toastId = ++id
    toasts.push({ id: toastId, message, type })
    setTimeout(() => {
      const idx = toasts.findIndex(t => t.id === toastId)
      if (idx !== -1) toasts.splice(idx, 1)
    }, duration)
  }

  function success(msg, duration) { push(msg, 'success', duration) }
  function error(msg, duration) { push(msg, 'error', duration) }
  function warning(msg, duration) { push(msg, 'warning', duration) }
  function info(msg, duration) { push(msg, 'info', duration) }

  return { toasts, push, success, error, warning, info }
}
