import { computed, ref, type Ref } from 'vue';
import { onServerEvent } from '../../../shared/realtime/browser';
import { NOTIFICATIONS_CHANGED_EVENT, type NotificationsMarkResponse } from '../contract';
import type { NotificationsClient } from './client';
import { notificationsRefusalText } from './refusals';
import { toNotificationItem, type NotificationItem } from './view';

export interface NotificationsFeed {
  readonly items: Readonly<Ref<NotificationItem[]>>;
  /** Unread count as the server reports it. */
  readonly unread: Readonly<Ref<number>>;
  /** What the bell says when the list or a mark-read call fails; anyone may set it. */
  readonly error: Ref<string>;
  load(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  /** Loads now and refetches whenever the server says the account's notifications changed; returns the stop function. */
  start(): () => void;
}

/**
 * The signed-in account's notifications for the bell. Live through the
 * shared server-event stream: no polling, and after a dropped connection
 * comes back the stream's resume event refetches what was missed.
 */
export function createNotificationsFeed(client: NotificationsClient): NotificationsFeed {
  const items = ref<NotificationItem[]>([]);
  const unread = ref(0);
  const error = ref('');
  // Only the newest load may write, so a slow answer never overwrites a newer one.
  let latest = 0;

  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      const response = await client.list();
      if (ticket !== latest) return;
      if (!response.success) {
        items.value = [];
        unread.value = 0;
        // The session ending is the shell's business; the bell just empties.
        error.value = response.code === 'UNAUTHORIZED' ? '' : notificationsRefusalText(response.code);
        return;
      }
      items.value = response.data.notifications.map(toNotificationItem);
      unread.value = response.data.unread_count;
      error.value = '';
    } catch (cause) {
      console.error(cause);
      if (ticket === latest) error.value = 'Notifikasi belum bisa dimuat. Coba lagi sebentar lagi.';
    }
  }

  /** Runs a mark-read call, then reloads; a refusal is said after the reload so it stays on screen. */
  async function mark(call: () => Promise<NotificationsMarkResponse>): Promise<void> {
    let message = '';
    try {
      const response = await call();
      // Gone already (say, an invitation answered elsewhere): the reload drops it.
      if (!response.success && response.code !== 'NOTIFICATION_NOT_FOUND') message = notificationsRefusalText(response.code);
    } catch (cause) {
      console.error(cause);
      message = 'Notifikasi belum bisa ditandai dibaca. Coba lagi.';
    }
    await load();
    if (message) error.value = message;
  }

  function start(): () => void {
    const stop = onServerEvent(NOTIFICATIONS_CHANGED_EVENT, () => void load());
    void load();
    return stop;
  }

  return {
    items: computed(() => items.value),
    unread: computed(() => unread.value),
    error,
    load,
    markRead: (id) => mark(() => client.markRead(id)),
    markAllRead: () => mark(() => client.markAllRead()),
    start,
  };
}
