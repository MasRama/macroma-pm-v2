import type { PersonRef } from '../../../shared/ui';
import { PROJECTS_NOTIFICATION_TYPES, TASK_COLUMNS, type TaskMovedNotificationData, type TaskStatus } from '../../projects/web';
import { WORKSPACE_NOTIFICATION_TYPES } from '../../workspaces/web';
import type { Notification } from '../contract';

/** The notification types the bell knows how to say; others stay out of the list. */
export type NotificationKind = 'invited' | 'invite-accepted' | 'task-moved';

/** Where a moved task went, for a "task-moved" row. */
export interface TaskMove {
  projectId: string;
  taskId: string;
  from: TaskStatus;
  to: TaskStatus;
  /** The task's new version, already written like `v1.2.3`. */
  version: string;
}

/** One row of the bell menu. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  /** Who did it; notifications carry only a name, so the avatar shows initials. */
  actor: PersonRef;
  /** Workspace name, or the task title for a task move. */
  subject: string;
  workspaceId: string | null;
  /** Invitation token an "invited" row answers with Terima/Tolak. */
  invitationToken: string | null;
  /** The move a "task-moved" row is about; `null` for other kinds. */
  move: TaskMove | null;
  /** ISO time the notification was created. */
  at: string;
  unread: boolean;
}

function text(data: Notification['data'], key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function isColumn(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_COLUMNS as readonly string[]).includes(value);
}

/** The task move a notification carries, or `null` when its data is not a whole task move. */
function taskMove(data: Notification['data']): TaskMovedNotificationData | null {
  const keys = ['project_id', 'project_name', 'task_id', 'task_title', 'version', 'actor_id', 'actor_name'] as const;
  if (!keys.every((key) => typeof data[key] === 'string')) return null;
  if (!isColumn(data.column_from) || !isColumn(data.column_to)) return null;
  return data as unknown as TaskMovedNotificationData;
}

/** Maps one API notification onto the row the bell shows, or `null` for a type it does not know. */
export function toNotificationItem(notification: Notification): NotificationItem | null {
  const { data } = notification;
  const row = {
    id: notification.id,
    subject: text(data, 'workspace_name'),
    workspaceId: text(data, 'workspace_id') || null,
    move: null,
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
    case PROJECTS_NOTIFICATION_TYPES.taskMoved: {
      const moved = taskMove(data);
      if (!moved) return null;
      return {
        ...row,
        kind: 'task-moved',
        actor: { id: moved.actor_id, name: moved.actor_name },
        subject: moved.task_title,
        workspaceId: null,
        invitationToken: null,
        move: { projectId: moved.project_id, taskId: moved.task_id, from: moved.column_from, to: moved.column_to, version: moved.version },
      };
    }
    default:
      return null;
  }
}
