<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthSession } from '../../features/auth/web';
import { ChatDrawer, NewWorkspaceModal } from '../../features/workspaces/web';
import { navigationLinks } from '../navigation';
import AppFrame from './AppFrame.vue';
import type { ShellLink } from './shell-types';

/*
 * Wires the frame to the session: who is signed in, admin links the session
 * may open, sign-out, and the chat drawer (`?chat=1`). Workspaces, projects,
 * chat and notifications are empty until the pages are wired to the
 * Macroma API (phase 2).
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
      error.value = response.message;
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
    @chat="toggleChat"
    @new-workspace="newWorkspaceOpen = true"
    @logout="logout"
  >
    <slot />
  </AppFrame>
  <ChatDrawer :open="chatOpen" workspace-name="Workspace" :me-id="user?.id ?? null" @close="toggleChat" />
  <NewWorkspaceModal :open="newWorkspaceOpen" @close="newWorkspaceOpen = false" @submit="newWorkspaceOpen = false" />
</template>
