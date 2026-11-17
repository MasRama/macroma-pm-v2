import type { PersonRef } from '../../../shared/ui';
import { WORKSPACE_NOTIFICATION_TYPES } from '../../workspaces/web';
import type { Notification } from '../contract';

/** The notification types the bell knows how to say; others stay out of the list. */
export type NotificationKind = 'invited' | 'invite-accepted';

/** One row of the bell menu. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  /** Who did it; notifications carry only a name, so the avatar shows initials. */
  actor: PersonRef;
  /** Workspace name the row is about. */
  subject: string;
  workspaceId: string | null;
  /** Invitation token an "invited" row answers with Terima/Tolak. */
  invitationToken: string | null;
  /** ISO time the notification was created. */
  at: string;
  unread: boolean;
}

function text(data: Notification['data'], key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

/** Maps one API notification onto the row the bell shows, or `null` for a type it does not know. */
export function toNotificationItem(notification: Notification): NotificationItem | null {
  const { data } = notification;
  const row = {
    id: notification.id,
    subject: text(data, 'workspace_name'),
    workspaceId: text(data, 'workspace_id') || null,
    at: new Date(notification.created_at).toISOString(),
    unread: !notification.is_read,
  };
  switch (notification.type) {
    case WORKSPACE_NOTIFICATION_TYPES.invitation: {
      const name = text(data, 'inviter_name');
      return { ...row, kind: 'invited', actor: { id: name, name }, invitationToken: text(data, 'token') || null };
    }
    case WORKSPACE_NOTIFICATION_TYPES.invitationAccepted: {
      const name = text(data, 'accepter_name');
      return { ...row, kind: 'invite-accepted', actor: { id: name, name }, invitationToken: null };
    }
    default:
      return null;
  }
}
