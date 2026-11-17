import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import type { NotificationsListSuccess, NotificationsMarkSuccess } from '../contract';
import { createGuard, forbidden } from '../../../shared/security';
import type { NotificationsServerHost } from './host';
import { announceNotifications, notificationsChangedTopic } from './live';
import { countUnread, findNotificationOwner, listNotifications, markAllRead, markRead } from './repository';

export function createNotificationRoutes(host: NotificationsServerHost) {
  // Declared with the routes, so the application knows the topic once composed.
  notificationsChangedTopic();
  const guard = createGuard((context) => host.resolveActor(getCookie(context, host.sessionCookieName)));

  return new Hono()
    .get('/', guard.signedIn, (context) => {
      const actor = guard.actor(context);
      return context.json({
        success: true as const,
        message: 'OK',
        data: { notifications: listNotifications(actor.id), unread_count: countUnread(actor.id) },
      } satisfies NotificationsListSuccess);
    })
    .post('/read-all', guard.signedIn, (context) => {
      const actor = guard.actor(context);
      if (markAllRead(actor.id) > 0) announceNotifications([actor.id]);
      return context.json({
        success: true as const,
        message: 'All notifications marked as read',
      } satisfies NotificationsMarkSuccess);
    })
    .post('/:id/read', guard.signedIn, (context) => {
      const actor = guard.actor(context);
      const id = context.req.param('id');
      const owner = findNotificationOwner(id);
      if (owner === undefined) {
        return context.json(
          { success: false as const, message: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' as const },
          404,
        );
      }
      if (owner !== actor.id) return forbidden(context, 'This notification belongs to another account');
      if (markRead(id)) announceNotifications([actor.id]);
      return context.json({ success: true as const, message: 'Marked as read' } satisfies NotificationsMarkSuccess);
    });
}
