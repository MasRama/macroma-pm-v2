import { z } from 'zod';
import { API_REFUSAL_CODES } from '../../shared/security/codes';

export const featureName = 'notifications' as const;
export type FeatureName = typeof featureName;

/** Live update topic: one of the account's notifications was created, read or withdrawn; refetch the list. */
export const NOTIFICATIONS_CHANGED_EVENT = 'notifications.changed';

/** How many notifications the list returns, newest first. */
export const NOTIFICATIONS_LIST_LIMIT = 30;

/** Refusals Notifications adds to the shared API codes. */
export const NOTIFICATIONS_REFUSAL_CODES = ['NOTIFICATION_NOT_FOUND'] as const;

/** What a notification carries for its type; values stay flat so any page can render them. */
export type NotificationData = Record<string, string | number | boolean | null>;

/**
 * Response schemas, built on demand: routes type their responses against them
 * and contract tests parse real responses with them. Strict, so an undeclared
 * field fails.
 */
export function notificationsResponseSchemas() {
  const notification = z.strictObject({
    id: z.string(),
    type: z.string(),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    is_read: z.boolean(),
    created_at: z.number(),
  });
  const message = z.strictObject({ success: z.literal(true), message: z.string() });
  return {
    notification,
    listSuccess: z.strictObject({
      success: z.literal(true),
      message: z.string(),
      data: z.strictObject({
        notifications: z.array(notification),
        unread_count: z.number(),
      }),
    }),
    markSuccess: message,
    error: z.strictObject({
      success: z.literal(false),
      message: z.string(),
      code: z.enum([...API_REFUSAL_CODES, ...NOTIFICATIONS_REFUSAL_CODES]),
      errors: z.record(z.string(), z.array(z.string())).optional(),
    }),
  };
}

type NotificationsResponseSchemas = ReturnType<typeof notificationsResponseSchemas>;
export type Notification = z.infer<NotificationsResponseSchemas['notification']>;
export type NotificationsListSuccess = z.infer<NotificationsResponseSchemas['listSuccess']>;
export type NotificationsMarkSuccess = z.infer<NotificationsResponseSchemas['markSuccess']>;
export type NotificationsError = z.infer<NotificationsResponseSchemas['error']>;
export type NotificationsListResponse = NotificationsListSuccess | NotificationsError;
export type NotificationsMarkResponse = NotificationsMarkSuccess | NotificationsError;
