/* Browser boundary of the notifications Feature: the typed API client and the bell menu the app shell shows. */
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
export type { NotificationItem } from './view';
