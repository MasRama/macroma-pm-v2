import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../../shared/database';
import { NOTIFICATIONS_LIST_LIMIT, type Notification, type NotificationData } from '../contract';

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  data_json: string;
  read_at: number | null;
  created_at: number;
}

function dataFromRow(value: string): NotificationData {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as NotificationData;
  } catch {
    // A corrupt row must not make the list unreadable.
  }
  return {};
}

function fromRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    data: dataFromRow(row.data_json),
    is_read: row.read_at !== null,
    created_at: row.created_at,
  };
}

export function listNotifications(userId: string, limit = NOTIFICATIONS_LIST_LIMIT): Notification[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, user_id, type, data_json, read_at, created_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, limit) as NotificationRow[];
  return rows.map(fromRow);
}

export function countUnread(userId: string): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId) as { count: number };
  return row.count;
}

export function findNotificationOwner(id: string): string | undefined {
  const row = getDatabase().prepare('SELECT user_id FROM notifications WHERE id = ?').get(id) as
    | { user_id: string }
    | undefined;
  return row?.user_id;
}

export function insertNotification(input: {
  id?: string;
  userId: string;
  type: string;
  data: NotificationData;
  readAt?: number | null;
  createdAt?: number;
}): Notification {
  const row: NotificationRow = {
    id: input.id ?? randomUUID(),
    user_id: input.userId,
    type: input.type,
    data_json: JSON.stringify(input.data),
    read_at: input.readAt ?? null,
    created_at: input.createdAt ?? Date.now(),
  };
  getDatabase()
    .prepare(
      `INSERT INTO notifications (id, user_id, type, data_json, read_at, created_at)
       VALUES (@id, @user_id, @type, @data_json, @read_at, @created_at)`,
    )
    .run(row);
  return fromRow(row);
}

/** Marks one notification read; returns whether it was unread. */
export function markRead(id: string, now = Date.now()): boolean {
  return getDatabase().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(now, id).changes > 0;
}

export function markAllRead(userId: string, now = Date.now()): number {
  return getDatabase()
    .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .run(now, userId).changes;
}

const DATA_FIELD = /^[a-z][a-z0-9_]*$/;

/** Deletes notifications of `type` whose data field equals `value`; returns the accounts that had one. */
export function deleteNotificationsMatching(type: string, field: string, value: string | number): string[] {
  if (!DATA_FIELD.test(field)) throw new Error(`Invalid notification data field "${field}"`);
  const database = getDatabase();
  const path = `$.${field}`;
  return database.transaction(() => {
    const owners = database
      .prepare('SELECT DISTINCT user_id FROM notifications WHERE type = ? AND json_extract(data_json, ?) = ?')
      .all(type, path, value) as Array<{ user_id: string }>;
    database.prepare('DELETE FROM notifications WHERE type = ? AND json_extract(data_json, ?) = ?').run(type, path, value);
    return owners.map((owner) => owner.user_id);
  })();
}

export function deleteNotificationsOf(userIds: readonly string[]): number {
  if (userIds.length === 0) return 0;
  const placeholders = userIds.map(() => '?').join(', ');
  return getDatabase().prepare(`DELETE FROM notifications WHERE user_id IN (${placeholders})`).run(...userIds).changes;
}
