<script setup lang="ts">
import { onUnmounted } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import AppShell from './layouts/AppShell.vue';
import { startLiveUpdates } from './live-updates';
import { initializeTheme } from './theme';

const route = useRoute();
onUnmounted(startLiveUpdates(useRouter()));
initializeTheme();
</script>

<template>
  <RouterView v-slot="{ Component }">
    <AppShell v-if="route.meta.requiresAuth && !route.meta.standaloneAuth">
      <component :is="Component" />
    </AppShell>
    <component v-else :is="Component" />
  </RouterView>
</template>
