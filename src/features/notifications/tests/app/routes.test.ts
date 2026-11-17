import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../../../app/server';
import { grantAdmin, signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { closeEventStreams, EVENTS_PATH, STREAM_READY_EVENT } from '../../../../shared/realtime';
import { readEvents, type EventReader } from '../../../../shared/realtime/tests/helpers';
import { csrfHeaders, issueCsrf } from '../../../../shared/security/tests/helpers';
import { NOTIFICATIONS_CHANGED_EVENT, NOTIFICATIONS_LIST_LIMIT } from '../../contract';
import { notify, withdrawNotifications } from '../../index';

async function send(persona: Persona, method: string, path: string, body?: unknown): Promise<Response> {
  const csrf = await issueCsrf(app, persona.cookie);
  return app.request(path, {
    method,
    headers: csrfHeaders(csrf, body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function list(persona: Persona) {
  const response = await app.request('/api/notifications', { headers: { Cookie: persona.cookie } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { notifications: Array<{ id: string; type: string; data: unknown; is_read: boolean }>; unread_count: number } }).data;
}

async function listen(persona: Persona): Promise<EventReader> {
  const response = await app.request(EVENTS_PATH, { headers: { Cookie: persona.cookie } });
  expect(response.status).toBe(200);
  const events = readEvents(response);
  expect(await events.next()).toBe(STREAM_READY_EVENT);
  return events;
}

/** Every event that arrives until the stream stays quiet for `quietMs`. */
async function drain(events: EventReader, quietMs = 150): Promise<string[]> {
  const seen: string[] = [];
  for (let event = await events.next(quietMs); event !== 'timeout' && event !== 'closed'; event = await events.next(quietMs)) {
    seen.push(event);
  }
  return seen;
}

afterEach(() => closeEventStreams());

describe('notifications', () => {
  it('lists only the account’s own notifications, newest first, with the unread count', async () => {
    const reader = await signUp('Notified Reader');
    const other = await signUp('Notified Other');
    expect(await list(reader)).toEqual({ notifications: [], unread_count: 0 });

    notify(reader.id, 'workspace_invitation', { workspace_name: 'Alpha', token: 'tok-1' });
    notify(reader.id, 'invitation_accepted', { workspace_name: 'Beta', accepter_name: 'Ada' });
    notify(other.id, 'invitation_accepted', { workspace_name: 'Gamma', accepter_name: 'Bob' });

    const listed = await list(reader);
    expect(listed.unread_count).toBe(2);
    expect(listed.notifications.map((notification) => notification.type)).toEqual(['invitation_accepted', 'workspace_invitation']);
    expect(listed.notifications[1]).toMatchObject({ data: { workspace_name: 'Alpha', token: 'tok-1' }, is_read: false });
  });

  it(`returns at most ${NOTIFICATIONS_LIST_LIMIT} notifications but counts every unread one`, async () => {
    const reader = await signUp('Busy Reader');
    for (let index = 0; index < NOTIFICATIONS_LIST_LIMIT + 5; index += 1) notify(reader.id, 'test', { index });
    const listed = await list(reader);
    expect(listed.notifications).toHaveLength(NOTIFICATIONS_LIST_LIMIT);
    expect(listed.unread_count).toBe(NOTIFICATIONS_LIST_LIMIT + 5);
  });

  it('marks one notification read, only for its owner', async () => {
    const owner = await signUp('Notification Owner');
    const stranger = await signUp('Notification Stranger');
    const notification = notify(owner.id, 'test', {});

    const missing = await send(owner, 'POST', `/api/notifications/${randomUUID()}/read`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });

    const refused = await send(stranger, 'POST', `/api/notifications/${notification.id}/read`);
    expect(refused.status).toBe(403);
    expect((await list(owner)).unread_count).toBe(1);

    expect((await send(owner, 'POST', `/api/notifications/${notification.id}/read`)).status).toBe(200);
    const listed = await list(owner);
    expect(listed.unread_count).toBe(0);
    expect(listed.notifications[0].is_read).toBe(true);
  });

  it('announces a read only when the notification was unread', async () => {
    const owner = await signUp('Notification Reader');
    const notification = notify(owner.id, 'test', {});
    const events = await listen(owner);

    expect((await send(owner, 'POST', `/api/notifications/${notification.id}/read`)).status).toBe(200);
    expect(await drain(events)).toEqual([NOTIFICATIONS_CHANGED_EVENT]);

    expect((await send(owner, 'POST', `/api/notifications/${notification.id}/read`)).status).toBe(200);
    expect((await send(owner, 'POST', '/api/notifications/read-all')).status).toBe(200);
    expect(await drain(events)).toEqual([]);
  });

  it('marks every notification of the account read and leaves other accounts alone', async () => {
    const owner = await signUp('Read All Owner');
    const other = await signUp('Read All Other');
    notify(owner.id, 'test', {});
    notify(owner.id, 'test', {});
    notify(other.id, 'test', {});

    expect((await send(owner, 'POST', '/api/notifications/read-all')).status).toBe(200);
    expect((await list(owner)).unread_count).toBe(0);
    expect((await list(other)).unread_count).toBe(1);
  });

  it('withdraws the notifications whose data matches, and only those', async () => {
    const invitee = await signUp('Withdrawn Invitee');
    const token = randomUUID();
    notify(invitee.id, 'workspace_invitation', { token });
    notify(invitee.id, 'workspace_invitation', { token: randomUUID() });
    notify(invitee.id, 'invitation_accepted', { token });

    expect(withdrawNotifications('workspace_invitation', 'token', token)).toBe(1);
    const listed = await list(invitee);
    expect(listed.notifications).toHaveLength(2);
    expect(listed.notifications.some((notification) => notification.type === 'workspace_invitation' && (notification.data as { token: string }).token === token)).toBe(false);
    expect(() => withdrawNotifications('workspace_invitation', "token') OR 1=1 --", token)).toThrow();
  });

  it('forgets the notifications of a deleted account', async () => {
    const admin = await signUp('Notification Admin');
    grantAdmin(admin.id);
    const doomed = await signUp('Doomed Account');
    notify(doomed.id, 'test', {});

    expect((await send(admin, 'DELETE', '/api/users', { ids: [doomed.id] })).status).toBe(200);
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?').get(doomed.id)).toEqual({ count: 0 });
  });

  it('refuses anonymous callers', async () => {
    expect((await app.request('/api/notifications')).status).toBe(401);
  });
});
