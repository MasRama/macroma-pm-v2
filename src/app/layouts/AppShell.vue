<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { csrfHeaders, ensureCsrfToken, useAuthSession } from '../../features/auth/web';
import { createNotificationsClient, createNotificationsFeed } from '../../features/notifications/web';
import { ChatDrawer, createWorkspacesClient, NewWorkspaceModal, workspacesRefusalText } from '../../features/workspaces/web';
import { navigationLinks } from '../navigation';
import AppFrame from './AppFrame.vue';
import type { ShellLink } from './shell-types';

/*
 * Wires the frame to the session: who is signed in, admin links the session
 * may open, sign-out, the chat drawer (`?chat=1`), and the live notification
 * bell with its invitation answers. Workspaces, projects and chat are empty
 * until those pages are wired to the Macroma API.
 */
const ADMIN_LABELS: Record<string, string> = {
  '/users': 'Pengguna',
  '/roles': 'Role & izin',
  '/activity': 'Log audit',
};

const authSession = useAuthSession();
const route = useRoute();
const router = useRouter();
const loggingOut = ref(false);
const error = ref('');
const newWorkspaceOpen = ref(false);

const csrf = { headers: (extra?: HeadersInit) => csrfHeaders(extra), ensureToken: () => ensureCsrfToken() };
const feed = createNotificationsFeed(createNotificationsClient({ csrf }));
const workspacesClient = createWorkspacesClient({ csrf });
const notificationsBusy = ref(false);
let stopFeed: (() => void) | undefined;
onMounted(() => {
  stopFeed = feed.start();
});
onBeforeUnmount(() => stopFeed?.());

async function busyWith(work: () => Promise<void>): Promise<void> {
  if (notificationsBusy.value) return;
  notificationsBusy.value = true;
  try {
    await work();
  } finally {
    notificationsBusy.value = false;
  }
}

function answerInvitation(token: string, action: 'accept' | 'decline'): Promise<void> {
  return busyWith(async () => {
    let message = '';
    try {
      const response = await workspacesClient.respondInvitation(token, { action });
      // Answering is refused as FORBIDDEN only when the invitation was sent to another account.
      if (!response.success)
        message = response.code === 'FORBIDDEN' ? 'Undangan ini untuk akun lain.' : workspacesRefusalText(response.code);
    } catch (cause) {
      console.error(cause);
      message = 'Undangan belum bisa dijawab. Coba lagi.';
    }
    // The server withdraws an answered invitation's notification; show the list as it is now.
    await feed.load();
    if (message) feed.error.value = message;
  });
}

const user = computed(() => {
  const current = authSession.user.value;
  return current ? { id: current.id, name: current.name, avatar: current.avatar, caption: current.email } : null;
});
const adminLinks = computed<ShellLink[]>(() =>
  navigationLinks(router.options.routes, authSession.allows)
    .filter((link) => link.to in ADMIN_LABELS)
    .map((link) => ({ to: link.to, label: ADMIN_LABELS[link.to]! })),
);
const chatOpen = computed(() => route.query.chat === '1');

function toggleChat(): void {
  const query = { ...route.query };
  if (chatOpen.value) delete query.chat;
  else query.chat = '1';
  void router.replace({ query });
}

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  error.value = '';
  try {
    const response = await authSession.logout();
    if (!response.success) {
      // Sign-out is refused only for a stale page or too many requests; either way, trying again is the answer.
      error.value = 'Belum bisa keluar. Coba lagi.';
      return;
    }
    await router.replace({ name: 'login' });
  } catch (cause) {
    console.error(cause);
    error.value = 'Belum bisa keluar. Coba lagi.';
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <AppFrame
    :user="user"
    :chat-open="chatOpen"
    :admin-links="adminLinks"
    :logging-out="loggingOut"
    :error="error"
    :notifications="feed.items.value"
    :notifications-unread="feed.unread.value"
    :notifications-busy="notificationsBusy"
    :notifications-error="feed.error.value"
    @chat="toggleChat"
    @accept-invite="answerInvitation($event, 'accept')"
    @decline-invite="answerInvitation($event, 'decline')"
    @read-notification="busyWith(() => feed.markRead($event))"
    @mark-notifications-read="busyWith(() => feed.markAllRead())"
    @new-workspace="newWorkspaceOpen = true"
    @logout="logout"
  >
    <slot />
  </AppFrame>
  <ChatDrawer :open="chatOpen" workspace-name="Workspace" :me-id="user?.id ?? null" @close="toggleChat" />
  <NewWorkspaceModal :open="newWorkspaceOpen" @close="newWorkspaceOpen = false" @submit="newWorkspaceOpen = false" />
</template>
