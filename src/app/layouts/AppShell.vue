<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { csrfHeaders, ensureCsrfToken, useAuthSession } from '../../features/auth/web';
import { createNotificationsClient, createNotificationsFeed, type NotificationItem } from '../../features/notifications/web';
import {
  ChatDrawer,
  createWorkspaceChat,
  NewWorkspaceModal,
  type NewWorkspaceInput,
  workspacesFieldTexts,
  workspacesRefusalText,
} from '../../features/workspaces/web';
import { workspacesClient } from '../api-clients';
import { currentWorkspace, currentWorkspaceId, newWorkspaceOpen, projectList, workspaceList } from '../shell-state';
import { navigationLinks } from '../navigation';
import AppFrame from './AppFrame.vue';
import type { ShellLink } from './shell-types';

/*
 * Wires the frame to the session and the Workspaces API: who is signed in,
 * admin links the session may open, sign-out, the workspace switcher and
 * "Workspace baru", the sidebar's project list, the chat drawer (`?chat=1`)
 * of the workspace in view with its unread badge, and the live notification
 * bell with its invitation answers and task moves.
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
const newWorkspaceBusy = ref(false);
const newWorkspaceError = ref<string | undefined>();

const meId = () => authSession.user.value?.id ?? null;
const chat = createWorkspaceChat(workspacesClient, meId);
const chatDraft = ref('');

/** This browser's last workspace, so the switcher and chat open where the person left off. */
const LAST_WORKSPACE_KEY = 'macroma.workspace';
function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}
function remember(id: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    // Storage blocked: the first workspace is used next time.
  }
}

const workspaces = computed(() => workspaceList.items.value);
/** The workspace in view: the open workspace page, else the last one used, else the first. */
const workspaceInView = computed<string | null>(() => {
  const ids = workspaces.value.map((workspace) => workspace.id);
  const onPage = route.name === 'workspace' ? String(route.params.workspaceId) : null;
  if (onPage && ids.includes(onPage)) return onPage;
  const last = remembered();
  return last && ids.includes(last) ? last : (ids[0] ?? null);
});
watch(
  workspaceInView,
  (id) => {
    currentWorkspaceId.value = id;
    if (id) remember(id);
    void chat.select(id);
  },
  { immediate: true },
);
watch(newWorkspaceOpen, (open) => {
  if (open) newWorkspaceError.value = undefined;
});
const projects = computed(() =>
  projectList.items.value.map((project) => ({ id: project.id, name: project.name, batch: project.batch ?? null })),
);

let stopLive: (() => void) | undefined;
onMounted(() => {
  const stopList = workspaceList.start();
  const stopProjects = projectList.start();
  const stopChat = chat.start();
  stopLive = () => {
    stopList();
    stopProjects();
    stopChat();
  };
});
onBeforeUnmount(() => stopLive?.());

async function createWorkspace(input: NewWorkspaceInput): Promise<void> {
  if (newWorkspaceBusy.value) return;
  newWorkspaceBusy.value = true;
  newWorkspaceError.value = undefined;
  try {
    const response = await workspacesClient.create({ name: input.name, description: input.description || null });
    if (!response.success) {
      newWorkspaceError.value = workspacesFieldTexts(response.errors).name ?? workspacesRefusalText(response.code);
      return;
    }
    newWorkspaceOpen.value = false;
    await workspaceList.load();
    await router.push({ name: 'workspace', params: { workspaceId: response.data.workspace.id } });
  } catch (cause) {
    console.error(cause);
    newWorkspaceError.value = 'Workspace belum bisa dibuat. Coba lagi.';
  } finally {
    newWorkspaceBusy.value = false;
  }
}

async function sendMessage(body: string): Promise<void> {
  if (await chat.send(body)) {
    chatDraft.value = '';
    chat.markSeen();
  }
}

const csrf = { headers: (extra?: HeadersInit) => csrfHeaders(extra), ensureToken: () => ensureCsrfToken() };
const feed = createNotificationsFeed(createNotificationsClient({ csrf }));
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

/** A task-moved row opens that task on its board, marking the row read first when it is unread. */
async function openNotificationTask(item: NotificationItem): Promise<void> {
  if (!item.move) return;
  const { projectId, taskId } = item.move;
  if (item.unread) await busyWith(() => feed.markRead(item.id));
  await router.push({ name: 'project-task', params: { projectId, taskId } });
}

const user = computed(() => {
  const current = authSession.user.value;
  if (!current) return null;
  const role = currentWorkspace.value?.role;
  const caption = role === 'owner' ? 'Owner' : role === 'member' ? 'Member' : current.email;
  return { id: current.id, name: current.name, avatar: current.avatar, caption };
});
const adminLinks = computed<ShellLink[]>(() =>
  navigationLinks(router.options.routes, authSession.allows)
    .filter((link) => link.to in ADMIN_LABELS)
    .map((link) => ({ to: link.to, label: ADMIN_LABELS[link.to]! })),
);
const chatOpen = computed(() => route.query.chat === '1');
// While the chat is on screen, everything in it counts as read.
watch(
  () => [chatOpen.value, chat.messages.value.length] as const,
  ([open]) => {
    if (open) chat.markSeen();
  },
);

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
    :workspaces="workspaces"
    :current-workspace-id="currentWorkspaceId"
    :projects="projects"
    :chat-unread="chatOpen ? 0 : chat.unread.value"
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
    @open-notification-task="openNotificationTask"
    @mark-notifications-read="busyWith(() => feed.markAllRead())"
    @new-workspace="newWorkspaceOpen = true"
    @logout="logout"
  >
    <slot />
  </AppFrame>
  <ChatDrawer
    v-model:draft="chatDraft"
    :open="chatOpen"
    :workspace-name="currentWorkspace?.name ?? 'Belum ada workspace'"
    :members="chat.members.value"
    :messages="chat.messages.value"
    :me-id="user?.id ?? null"
    :sending="chat.sending.value || !currentWorkspace"
    :error="chat.error.value || (workspaceList.loaded.value && !currentWorkspace ? 'Buat atau terima undangan workspace dulu untuk mulai chat.' : '')"
    @close="toggleChat"
    @send="sendMessage"
  />
  <NewWorkspaceModal
    :open="newWorkspaceOpen"
    :busy="newWorkspaceBusy"
    :name-error="newWorkspaceError"
    @close="newWorkspaceOpen = false"
    @submit="createWorkspace"
  />
</template>
