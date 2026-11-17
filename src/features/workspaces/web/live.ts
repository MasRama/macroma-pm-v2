import { computed, ref, type Ref } from 'vue';
import type { PersonRef } from '../../../shared/ui';
import { onServerEvent } from '../../../shared/realtime/browser';
import { WORKSPACES_CHANGED_EVENT, WORKSPACES_CHAT_EVENT } from '../contract';
import type { WorkspacesClient } from './client';
import { toChatMessage, toWorkspaceMember, toWorkspaceSummary, type ChatMessage, type WorkspaceSummary } from './view';

/*
 * Live state the app shell keeps while someone is signed in: the account's
 * workspaces and the chat of the workspace in view. Both refetch on their
 * server-event topic (and on the stream's resume), never by polling.
 */

export interface WorkspacesList {
  readonly items: Readonly<Ref<WorkspaceSummary[]>>;
  readonly loaded: Readonly<Ref<boolean>>;
  readonly error: Ref<string>;
  load(): Promise<void>;
  /** Loads now and on every `workspaces.changed`; returns the stop function. */
  start(): () => void;
}

export function createWorkspacesList(client: WorkspacesClient): WorkspacesList {
  const items = ref<WorkspaceSummary[]>([]);
  const loaded = ref(false);
  const error = ref('');
  let latest = 0;

  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      const response = await client.list();
      if (ticket !== latest) return;
      if (!response.success) {
        error.value = response.code === 'UNAUTHORIZED' ? '' : response.message;
        return;
      }
      items.value = response.data.workspaces.map(toWorkspaceSummary);
      loaded.value = true;
      error.value = '';
    } catch (cause) {
      console.error(cause);
      if (ticket === latest) error.value = 'Daftar workspace belum bisa dimuat.';
    }
  }

  function start(): () => void {
    const stop = onServerEvent(WORKSPACES_CHANGED_EVENT, () => void load());
    void load();
    return stop;
  }

  return { items: computed(() => items.value), loaded: computed(() => loaded.value), error, load, start };
}

/** Where this browser remembers the last chat message seen per workspace. Per viewer, best effort. */
const SEEN_KEY = 'macroma.chat.seen.';

function readSeen(workspaceId: string): string | null {
  try {
    return localStorage.getItem(SEEN_KEY + workspaceId);
  } catch {
    return null;
  }
}

function writeSeen(workspaceId: string, messageId: string): void {
  try {
    localStorage.setItem(SEEN_KEY + workspaceId, messageId);
  } catch {
    // Storage blocked: the badge just counts from this page load.
  }
}

export interface WorkspaceChat {
  readonly workspaceId: Readonly<Ref<string | null>>;
  readonly messages: Readonly<Ref<ChatMessage[]>>;
  readonly members: Readonly<Ref<PersonRef[]>>;
  /** Messages from others since this browser last had the chat open. */
  readonly unread: Readonly<Ref<number>>;
  readonly sending: Readonly<Ref<boolean>>;
  readonly error: Ref<string>;
  /** Shows the chat of `id` (or nothing); loads its messages and members. */
  select(id: string | null): Promise<void>;
  /** Posts a message; resolves `true` once it is saved. */
  send(body: string): Promise<boolean>;
  /** The chat is on screen: everything in it counts as seen. */
  markSeen(): void;
  /** Refetches on `workspaces.chat` and `workspaces.changed`; returns the stop function. */
  start(): () => void;
}

/** What the chat says when a post is refused, by code. */
const SEND_REFUSALS: Partial<Record<string, string>> = {
  FORBIDDEN: 'Kamu bukan anggota workspace ini lagi.',
  WORKSPACE_NOT_FOUND: 'Workspace ini sudah tidak ada.',
};

export function createWorkspaceChat(client: WorkspacesClient, meId: () => string | null): WorkspaceChat {
  const workspaceId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const members = ref<PersonRef[]>([]);
  const seenId = ref<string | null>(null);
  const sending = ref(false);
  const error = ref('');
  let latest = 0;

  const unread = computed(() => {
    const me = meId();
    const from = messages.value.findIndex((message) => message.id === seenId.value);
    return messages.value.slice(from + 1).filter((message) => String(message.author.id) !== me).length;
  });

  async function loadMessages(): Promise<void> {
    const id = workspaceId.value;
    const ticket = ++latest;
    if (!id) return;
    try {
      const response = await client.messages(id);
      if (ticket !== latest || id !== workspaceId.value) return;
      if (!response.success) {
        messages.value = [];
        return;
      }
      messages.value = response.data.messages.map(toChatMessage);
      // First time this browser sees the chat: count from here, not the whole history.
      // An empty chat starts at '' so the messages that follow all count.
      if (seenId.value === null) {
        seenId.value = '';
        markSeen();
      }
    } catch (cause) {
      console.error(cause);
    }
  }

  async function loadMembers(): Promise<void> {
    const id = workspaceId.value;
    if (!id) return;
    try {
      const response = await client.get(id);
      if (id === workspaceId.value && response.success) members.value = response.data.members.map((row) => toWorkspaceMember(row).person);
    } catch (cause) {
      console.error(cause);
    }
  }

  async function select(id: string | null): Promise<void> {
    if (id === workspaceId.value) return;
    workspaceId.value = id;
    messages.value = [];
    members.value = [];
    error.value = '';
    seenId.value = id ? readSeen(id) : null;
    await Promise.all([loadMessages(), loadMembers()]);
  }

  function markSeen(): void {
    const last = messages.value[messages.value.length - 1];
    if (!workspaceId.value || !last) return;
    seenId.value = last.id;
    writeSeen(workspaceId.value, last.id);
  }

  async function send(body: string): Promise<boolean> {
    const id = workspaceId.value;
    if (!id || sending.value) return false;
    sending.value = true;
    error.value = '';
    try {
      const response = await client.postMessage(id, { message: body });
      if (!response.success) {
        error.value = response.errors?.message?.[0] ?? SEND_REFUSALS[response.code] ?? response.message;
        return false;
      }
      const posted = toChatMessage(response.data.message);
      if (!messages.value.some((message) => message.id === posted.id)) messages.value = [...messages.value, posted];
      return true;
    } catch (cause) {
      console.error(cause);
      error.value = 'Pesan belum terkirim. Coba lagi.';
      return false;
    } finally {
      sending.value = false;
    }
  }

  function start(): () => void {
    const stopChat = onServerEvent(WORKSPACES_CHAT_EVENT, () => void loadMessages());
    const stopChanged = onServerEvent(WORKSPACES_CHANGED_EVENT, () => void loadMembers());
    return () => {
      stopChat();
      stopChanged();
    };
  }

  return {
    workspaceId: computed(() => workspaceId.value),
    messages: computed(() => messages.value),
    members: computed(() => members.value),
    unread,
    sending: computed(() => sending.value),
    error,
    select,
    send,
    markSeen,
    start,
  };
}
