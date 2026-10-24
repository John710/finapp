<template>
  <div>
    <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight mb-6">{{ $t('settings.title') }}</h1>

    <template v-if="ready">
      <SettingsProfile />
      <SettingsIntegrations />
      <SettingsNotifications />
      <SettingsSecurity />
      <SettingsData />
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import SettingsProfile from '../components/settings/SettingsProfile.vue'
import SettingsIntegrations from '../components/settings/SettingsIntegrations.vue'
import SettingsNotifications from '../components/settings/SettingsNotifications.vue'
import SettingsSecurity from '../components/settings/SettingsSecurity.vue'
import SettingsData from '../components/settings/SettingsData.vue'

const auth = useAuthStore()
// Sections initialize from auth.user on mount — make sure it is loaded first
const ready = ref(false)

onMounted(async () => {
  if (auth.isAuthenticated && !auth.user) {
    await auth.fetchMe()
  }
  ready.value = true
})
</script>
