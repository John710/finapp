import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'

const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext
console.log('[push] isSupported:', isSupported, 'secureContext:', window.isSecureContext, 'hasSW:', 'serviceWorker' in navigator, 'hasPush:', 'PushManager' in window, 'permission:', Notification.permission)

const subscription = ref(null)
const loading = ref(false)
const serverConfigured = ref(false)

export function usePush() {
  const { t } = useI18n()

  async function getSubscription() {
    if (!isSupported) {
      console.log('[push] getSubscription skipped: not supported')
      return null
    }
    try {
      console.log('[push] Fetching VAPID public key...')
      const data = await api('/vapid-public-key')
      console.log('[push] VAPID public key received:', !!data.publicKey)
      serverConfigured.value = !!data.publicKey
      if (!serverConfigured.value) {
        console.warn('[push] Server VAPID public key is null — push not configured')
        return null
      }
      console.log('[push] Waiting for service worker...')
      const reg = await navigator.serviceWorker.ready
      console.log('[push] SW ready, scope:', reg.scope)
      subscription.value = await reg.pushManager.getSubscription()
      console.log('[push] Existing subscription:', !!subscription.value, 'Notification.permission:', Notification.permission)
      return subscription.value
    } catch (err) {
      console.error('[push] getSubscription failed:', err)
      serverConfigured.value = false
      return null
    }
  }

  async function subscribe() {
    if (!isSupported) {
      window.$toast?.showToast(t('notifications.push_require_https'), 'error')
      return
    }
    loading.value = true
    try {
      console.log('[push] Starting subscribe flow...')
      const data = await api('/vapid-public-key')
      const publicKey = data.publicKey
      serverConfigured.value = !!publicKey
      if (!publicKey) {
        window.$toast?.showToast(t('notifications.push_not_configured_msg'), 'error')
        console.warn('[push] Cannot subscribe: VAPID public key missing')
        return
      }

      console.log('[push] Requesting push subscription with publicKey...')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
      console.log('[push] Browser subscription obtained:', !!sub)
      await api('/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
      console.log('[push] Subscription sent to server successfully')
      subscription.value = sub
      window.$toast?.success(t('notifications.push_enabled'))
    } catch (err) {
      console.error('[push] subscribe failed:', err)
      const msg = err?.message || t('notifications.push_enable_failed')
      window.$toast?.showToast(msg, 'error')
    } finally {
      loading.value = false
    }
  }

  async function unsubscribe() {
    if (!isSupported || !subscription.value) return
    loading.value = true
    try {
      const sub = subscription.value
      await sub.unsubscribe()
      await api('/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })
      subscription.value = null
      window.$toast?.success(t('notifications.push_disabled'))
    } catch (err) {
      console.error('[push] unsubscribe failed:', err)
      window.$toast?.showToast(t('notifications.push_disable_failed'), 'error')
    } finally {
      loading.value = false
    }
  }

  return { isSupported, serverConfigured, subscription, loading, getSubscription, subscribe, unsubscribe }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}
