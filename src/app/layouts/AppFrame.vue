<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NotificationsMenu, type NotificationItem } from '../../features/notifications/web';
import { UiIcon, useEscape } from '../../shared/ui';
import AppSidebar from './AppSidebar.vue';
import type { ShellLink, ShellProject, ShellUser, ShellWorkspace } from './shell-types';

/**
 * The signed-in frame: 232px ink sidebar, 56px top bar (pages teleport their
 * breadcrumb and tabs into #shell-topbar), search, bell. Below 760px the
 * sidebar slides in from a menu button. Presentational: AppShell feeds it.
 */
withDefaults(
  defineProps<{
    user: ShellUser | null;
    workspaces?: ShellWorkspace[];
    currentWorkspaceId?: string | null;
    projects?: ShellProject[];
    chatUnread?: number;
    chatOpen?: boolean;
    adminLinks?: ShellLink[];
    notifications?: readonly NotificationItem[];
    notificationsUnread?: number | null;
    notificationsBusy?: boolean;
    notificationsError?: string;
    loggingOut?: boolean;
    error?: string;
  }>(),
  {
    workspaces: () => [],
    currentWorkspaceId: null,
    projects: () => [],
    chatUnread: 0,
    chatOpen: false,
    adminLinks: () => [],
    notifications: () => [],
    notificationsUnread: null,
    notificationsBusy: false,
    notificationsError: '',
    loggingOut: false,
    error: '',
  },
);
const emit = defineEmits<{
  chat: [];
  newWorkspace: [];
  logout: [];
  search: [query: string];
  acceptInvite: [token: string];
  declineInvite: [token: string];
  readNotification: [id: string];
  markNotificationsRead: [];
}>();

const route = useRoute();
const menuOpen = ref(false);
const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);

// The phone menu closes like every other overlay: on Escape.
useEscape(menuOpen, () => {
  menuOpen.value = false;
});

function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.value?.focus();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="shell">
    <div class="shell__side" :class="{ 'shell__side--open': menuOpen }">
      <AppSidebar
        :user="user"
        :workspaces="workspaces"
        :current-workspace-id="currentWorkspaceId"
        :projects="projects"
        :chat-unread="chatUnread"
        :chat-open="chatOpen"
        :admin-links="adminLinks"
        :logging-out="loggingOut"
        @chat="emit('chat')"
        @new-workspace="emit('newWorkspace')"
        @logout="emit('logout')"
      />
    </div>
    <div v-if="menuOpen" class="shell__scrim" @click="menuOpen = false" />

    <div class="shell__main">
      <header class="top">
        <button type="button" class="top__menu focus-ring" aria-label="Buka menu" :aria-expanded="menuOpen" @click="menuOpen = true">
          <UiIcon name="menu" :size="16" :stroke="2" />
        </button>
        <div id="shell-topbar" class="top__slot" />
        <form class="search" role="search" @submit.prevent="emit('search', query.trim())">
          <UiIcon name="search" :size="15" :stroke="2" />
          <label class="sr-only" for="shell-search">Cari</label>
          <input id="shell-search" ref="searchInput" v-model="query" type="search" placeholder="Cari task, versi, orang…" autocomplete="off" />
          <kbd class="mono">⌘K</kbd>
        </form>
        <NotificationsMenu
          :items="notifications"
          :unread-count="notificationsUnread"
          :busy="notificationsBusy"
          :error="notificationsError"
          @accept="emit('acceptInvite', $event)"
          @decline="emit('declineInvite', $event)"
          @read="emit('readNotification', $event)"
          @mark-all-read="emit('markNotificationsRead')"
        />
      </header>
      <p v-if="error" role="alert" class="shell__error">{{ error }}</p>
      <div class="shell__page"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;
  background: var(--bg);
  color: var(--ink);
}
.shell__side {
  height: 100%;
  flex-shrink: 0;
}
.shell__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.top {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 28px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
.top__menu {
  display: none;
}
.top__slot {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.search {
  margin-left: auto;
  width: 300px;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-small);
  background: var(--card);
  color: var(--mute);
}
.search:focus-within {
  border-color: var(--ink);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  font-size: 13px;
  color: var(--ink);
}
.search input::placeholder {
  color: var(--mute);
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.search kbd {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11px;
}
.shell__error {
  margin: 12px 28px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-revisi);
}
.shell__page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.shell__scrim {
  display: none;
}
@media (max-width: 760px) {
  .shell__side {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 70;
    transform: translateX(-100%);
    transition: transform 0.18s ease;
  }
  .shell__side--open {
    transform: none;
  }
  .shell__scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 65;
    background: var(--dim);
  }
  .top {
    height: auto;
    gap: 10px;
    padding: 12px 16px 0;
    border-bottom: 0;
  }
  .top__menu {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-small);
    background: var(--primary-bg);
    color: var(--primary-fg);
    cursor: pointer;
  }
  .search {
    display: none;
  }
  .top__slot {
    flex: 1;
    justify-content: flex-end;
  }
  .top__slot :deep(.crumb) {
    display: none;
  }
}
</style>
