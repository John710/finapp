import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api.js'
import { logger } from '@/utils/logger.js'

const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext
logger.log('[push] isSupported:', isSupported, 'secureContext:', window.isSecureContext, 'hasSW:', 'serviceWorker' in navigator, 'hasPush:', 'PushManager' in window, 'permission:', Notification.permission)

const subscription = ref(null)
const loading = ref(false)
const serverConfigured = ref(false)

export function usePush() {
  const { t } = useI18n()

  async function checkServerConfigured() {
    try {
      logger.log('[push] Fetching VAPID public key...')
      const data = await api('/vapid-public-key')
      logger.log('[push] VAPID public key received:', !!data.publicKey)
      serverConfigured.value = !!data.publicKey
      return data.publicKey || null
    } catch (err) {
      logger.error('[push] checkServerConfigured failed:', err)
      serverConfigured.value = false
      return null
    }
  }

  async function getSubscription() {
    if (!isSupported) {
      logger.log('[push] getSubscription skipped: not supported')
      return null
    }
    const publicKey = await checkServerConfigured()
    if (!publicKey) {
      logger.warn('[push] Server VAPID public key is null — push not configured')
      return null
    }
    try {
      logger.log('[push] Waiting for service worker...')
      const reg = await navigator.serviceWorker.ready
      logger.log('[push] SW ready, scope:', reg.scope)
      subscription.value = await reg.pushManager.getSubscription()
      logger.log('[push] Existing subscription:', !!subscription.value, 'Notification.permission:', Notification.permission)
      return subscription.value
    } catch (err) {
      logger.error('[push] getSubscription failed:', err)
      return null
    }
  }

  async function requestNotificationPermission() {
    if (Notification.permission === 'denied') {
      window.$toast?.error(t('notifications.push_denied'))
      return 'denied'
    }
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        window.$toast?.error(t('notifications.push_not_granted'))
        return permission
      }
    }
    return 'granted'
  }

  async function subscribe() {
    if (!isSupported) {
      window.$toast?.error(t('notifications.push_require_https'))
      return
    }
    const permission = await requestNotificationPermission()
    if (permission !== 'granted') {
      logger.warn('[push] Cannot subscribe: notification permission not granted')
      return
    }
    loading.value = true
    try {
      logger.log('[push] Starting subscribe flow...')
      const data = await api('/vapid-public-key')
      const publicKey = data.publicKey
      serverConfigured.value = !!publicKey
      if (!publicKey) {
        window.$toast?.error(t('notifications.push_not_configured_msg'))
        logger.warn('[push] Cannot subscribe: VAPID public key missing')
        return
      }

      logger.log('[push] Requesting push subscription with publicKey...')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
      logger.log('[push] Browser subscription obtained:', !!sub)
      await api('/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
      logger.log('[push] Subscription sent to server successfully')
      subscription.value = sub
      window.$toast?.success(t('notifications.push_enabled'))
    } catch (err) {
      logger.error('[push] subscribe failed:', err)
      const msg = err?.message || t('notifications.push_enable_failed')
      window.$toast?.error(msg)
    } finally {
      loading.value = false
    }
  }

  async function unsubscribe() {
    if (!isSupported || !subscription.value) return
    loading.value = true
    try {
      const sub = subscription.value
      // Tell the server first: if the browser unsubscribes but the server call
      // then fails, a dead subscription would keep receiving push attempts.
      await api('/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })
      await sub.unsubscribe().catch(() => {})
      subscription.value = null
      window.$toast?.success(t('notifications.push_disabled'))
    } catch (err) {
      logger.error('[push] unsubscribe failed:', err)
      window.$toast?.error(t('notifications.push_disable_failed'))
    } finally {
      loading.value = false
    }
  }

  return { isSupported, serverConfigured, subscription, loading, getSubscription, subscribe, unsubscribe, checkServerConfigured }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}
