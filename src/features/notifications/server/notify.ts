import type { Notification, NotificationData } from '../contract';
import { announceNotifications } from './live';
import { deleteNotificationsMatching, deleteNotificationsOf, insertNotification } from './repository';

/** Creates a notification for the account and tells its open pages to refetch. */
export function notify(userId: string, type: string, data: NotificationData): Notification {
  const notification = insertNotification({ userId, type, data });
  announceNotifications([userId]);
  return notification;
}

/**
 * Withdraws every notification of `type` whose data `field` equals `value`
 * (say, the invitation notice for a token once it is answered or cancelled).
 */
export function withdrawNotifications(type: string, field: string, value: string | number): number {
  const owners = deleteNotificationsMatching(type, field, value);
  announceNotifications(owners);
  return owners.length;
}

/** Removes the notifications of deleted accounts; Auth's users table is not ours to cascade from. */
export function forgetAccounts(userIds: readonly string[]): number {
  return deleteNotificationsOf(userIds);
}
