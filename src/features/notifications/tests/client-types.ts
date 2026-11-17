import { hc } from 'hono/client';
import type { createNotificationRoutes } from '..';
import type { NotificationsError } from '../contract';

/**
 * Compile-time checks that the web client sees the real routes: `npm run lint`
 * fails when they stop matching, including when an `@ts-expect-error` below
 * stops being an error. Never called.
 */
export async function notificationsRouteTypes(): Promise<void> {
  const notifications = hc<ReturnType<typeof createNotificationRoutes>>('/api/notifications');

  const listed = await (await notifications.index.$get()).json();
  if (listed.success) {
    const unread: number = listed.data.unread_count;
    void unread;
    const read: boolean = listed.data.notifications[0].is_read;
    void read;
  }

  // @ts-expect-error marking read needs the notification id
  await notifications[':id'].read.$post({ param: {} });

  const missing: NotificationsError = { success: false, message: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' };
  void missing;
  // @ts-expect-error Notifications declares no NOT_FOUND refusal
  const undeclared: NotificationsError = { success: false, message: 'Not found', code: 'NOT_FOUND' };
  void undeclared;
}
