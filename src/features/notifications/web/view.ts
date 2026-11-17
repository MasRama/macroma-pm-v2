import type { PersonRef } from '../../../shared/ui';

/** One row of the bell menu. */
export interface NotificationItem {
  id: number;
  kind: 'invited' | 'invite-accepted' | 'task-moved';
  actor: PersonRef;
  /** Workspace name (invitations) or task title (task moves). */
  subject: string;
  /** Status label a task moved to, e.g. "Revisi". */
  target?: string | null;
  /** Invitation id an "invited" row answers. */
  invitationId?: number | null;
  at: string;
  unread: boolean;
}
