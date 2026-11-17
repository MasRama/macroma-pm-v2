import { describe, expect, it } from 'vitest';
import { PROJECTS_NOTIFICATION_TYPES, projectsResponseSchemas } from '../../projects';
import { WORKSPACE_NOTIFICATION_TYPES } from '../../workspaces';
import type { Notification } from '../contract';
import { toNotificationItem } from '../web/view';

const moved = {
  project_id: 'p1',
  project_name: 'Apollo',
  task_id: 't1',
  task_title: 'Ship the bell',
  version: 'v1.2.3',
  column_from: 'review',
  column_to: 'revisi',
  actor_id: 'u2',
  actor_name: 'Azka Mover',
};

function notification(data: Notification['data'], type: string = PROJECTS_NOTIFICATION_TYPES.taskMoved): Notification {
  return { id: 'n1', type, data, is_read: false, created_at: Date.UTC(2026, 10, 17, 3, 8) };
}

describe('the bell row for a task move', () => {
  it('maps the data Projects sends onto a task-moved row', () => {
    // The fixture is the shape Projects promises, so this test breaks when that shape drifts.
    expect(projectsResponseSchemas().taskMovedNotificationData.parse(moved)).toEqual(moved);

    expect(toNotificationItem(notification(moved))).toEqual({
      id: 'n1',
      kind: 'task-moved',
      actor: { id: 'u2', name: 'Azka Mover' },
      subject: 'Ship the bell',
      workspaceId: null,
      invitationToken: null,
      move: { projectId: 'p1', taskId: 't1', from: 'review', to: 'revisi', version: 'v1.2.3' },
      at: '2026-11-17T03:08:00.000Z',
      unread: true,
    });
  });

  it('shows a task move whose data is not whole as a plain row', () => {
    const { task_id: _taskId, ...withoutTask } = moved;
    for (const data of [withoutTask, { ...moved, column_to: 'archived' }, { ...moved, version: 3 }]) {
      expect(toNotificationItem(notification(data))).toMatchObject({ id: 'n1', kind: 'other', actor: null, move: null, unread: true });
    }
  });

  it('shows a type the bell does not know as a plain unread row, so the list matches the unread count', () => {
    expect(toNotificationItem(notification({ anything: 'new' }, 'task_due_soon'))).toEqual({
      id: 'n1',
      kind: 'other',
      actor: null,
      subject: '',
      workspaceId: null,
      invitationToken: null,
      move: null,
      at: '2026-11-17T03:08:00.000Z',
      unread: true,
    });
  });

  it('gives other kinds no move', () => {
    const data = { workspace_id: 'w1', workspace_name: 'Nara Labs', inviter_name: 'Dimas', token: 'tok' };
    expect(toNotificationItem(notification(data, WORKSPACE_NOTIFICATION_TYPES.invitation))).toMatchObject({ kind: 'invited', move: null });
  });
});
