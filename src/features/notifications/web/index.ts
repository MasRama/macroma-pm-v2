/* Browser boundary of the notifications Feature: the typed API client, the live feed and the bell menu the app shell shows. */
export { createNotificationsClient } from './client';
export type { NotificationsClient, NotificationsClientOptions, NotificationsWebCsrf } from './client';
export {
  NOTIFICATIONS_CHANGED_EVENT,
  NOTIFICATIONS_LIST_LIMIT,
  NOTIFICATIONS_REFUSAL_CODES,
} from '../contract';
export type {
  Notification,
  NotificationData,
  NotificationsError,
  NotificationsListResponse,
  NotificationsListSuccess,
  NotificationsMarkResponse,
  NotificationsMarkSuccess,
} from '../contract';
export { default as NotificationsMenu } from './components/NotificationsMenu.vue';
export { createNotificationsFeed } from './feed';
export {
  NOTIFICATIONS_GENERIC_REFUSAL_TEXT,
  NOTIFICATIONS_REFUSAL_TEXT,
  notificationsRefusalText,
  type NotificationsRefusal,
} from './refusals';
export type { NotificationsFeed } from './feed';
export { toNotificationItem } from './view';
export type { NotificationItem, NotificationKind, TaskMove } from './view';
