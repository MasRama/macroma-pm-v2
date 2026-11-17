import type { Hono } from 'hono';
import { getCurrentUser, onAccountsDeleted, SESSION_COOKIE_NAME } from '../../features/auth';
import { createNotificationRoutes, forgetAccounts, type NotificationsServerHost } from '../../features/notifications';

// Notifications keep no foreign key into Auth's users table; deleted accounts lose theirs.
onAccountsDeleted(forgetAccounts);

const notificationsServerHost: NotificationsServerHost = {
  sessionCookieName: SESSION_COOKIE_NAME,
  resolveActor: (sessionToken) => {
    const user = getCurrentUser(sessionToken);
    return user ? { id: user.id } : undefined;
  },
};

export default function composeNotificationsServer(app: Hono): void {
  app.route('/api/notifications', createNotificationRoutes(notificationsServerHost));
}
