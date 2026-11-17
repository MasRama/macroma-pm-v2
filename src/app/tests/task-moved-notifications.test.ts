import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../server';
import { callApi } from './api';
import { grantAdmin, signUp, type Persona } from './personas';
import { closeEventStreams, EVENTS_PATH, STREAM_READY_EVENT } from '../../shared/realtime';
import { readEvents, type EventReader } from '../../shared/realtime/tests/helpers';
import { NOTIFICATIONS_CHANGED_EVENT, notificationsResponseSchemas } from '../../features/notifications';
import { PROJECTS_NOTIFICATION_TYPES, projectsResponseSchemas } from '../../features/projects';

const TASK_MOVED = PROJECTS_NOTIFICATION_TYPES.taskMoved;

async function createProject(owner: Persona, name = 'Apollo'): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function addMember(owner: Persona, projectId: string, member: Persona): Promise<void> {
  expect((await callApi(owner, 'POST', `/api/projects/${projectId}/members`, { email: member.email })).status).toBe(201);
}

async function createTask(persona: Persona, projectId: string, body: Record<string, unknown> = {}) {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Write docs', ...body });
  expect(created.status).toBe(201);
  return created.body.data.task as { id: string; revision: number };
}

async function move(persona: Persona, taskId: string, column: string, note?: string) {
  return callApi(persona, 'PATCH', `/api/tasks/${taskId}/move`, { column_id: column, ...(note === undefined ? {} : { note }) });
}

/** The account's task_moved notifications, parsed with the strict list schema. */
async function taskMovedNotices(persona: Persona) {
  const listed = await callApi(persona, 'GET', '/api/notifications');
  expect(listed.status).toBe(200);
  const parsed = notificationsResponseSchemas().listSuccess.parse(listed.body);
  return parsed.data.notifications.filter((notification) => notification.type === TASK_MOVED);
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

/** An owner's project with a task created by `creator`, assigned to `assignee`, and a separate `mover`. */
async function board() {
  const owner = await signUp('Board Owner');
  const creator = await signUp('Task Creator');
  const assignee = await signUp('Task Assignee');
  const mover = await signUp('Task Mover');
  const projectId = await createProject(owner);
  for (const member of [creator, assignee, mover]) await addMember(owner, projectId, member);
  const task = await createTask(creator, projectId, { title: 'Ship the bell', assignee_id: assignee.id });
  return { owner, creator, assignee, mover, projectId, task };
}

describe('task_moved notifications', () => {
  beforeEach(() => resetSecurityState());
  afterEach(() => closeEventStreams());

  it('tells the assignee and the creator once each, with the move in flat data', async () => {
    const { owner, creator, assignee, mover, projectId, task } = await board();

    const moved = await move(mover, task.id, 'ongoing');
    expect(moved.status).toBe(200);

    const expected = {
      project_id: projectId,
      project_name: 'Apollo',
      task_id: task.id,
      task_title: 'Ship the bell',
      version: moved.body.data.log.version,
      column_from: 'backlog',
      column_to: 'ongoing',
      actor_id: mover.id,
      actor_name: 'Task Mover',
    };
    expect(expected.version).toMatch(/^v\d+\.\d+\.\d+$/);
    for (const recipient of [creator, assignee]) {
      const notices = await taskMovedNotices(recipient);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ is_read: false, data: expected });
      expect(projectsResponseSchemas().taskMovedNotificationData.parse(notices[0].data)).toEqual(expected);
    }
    expect(await taskMovedNotices(mover)).toEqual([]);
    expect(await taskMovedNotices(owner)).toEqual([]);
  });

  it('sends one notification when the assignee is also the creator', async () => {
    const owner = await signUp('Solo Owner');
    const maker = await signUp('Solo Maker');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, maker);
    const task = await createTask(maker, projectId, { assignee_id: maker.id });

    expect((await move(owner, task.id, 'review')).status).toBe(200);
    expect(await taskMovedNotices(maker)).toHaveLength(1);
    expect(await taskMovedNotices(owner)).toEqual([]);
  });

  it('never notifies the account that moved the task', async () => {
    const { creator, assignee, task } = await board();

    expect((await move(creator, task.id, 'ongoing')).status).toBe(200);
    expect(await taskMovedNotices(creator)).toEqual([]);
    expect(await taskMovedNotices(assignee)).toHaveLength(1);

    expect((await move(assignee, task.id, 'review')).status).toBe(200);
    expect(await taskMovedNotices(assignee)).toHaveLength(1);
    expect(await taskMovedNotices(creator)).toHaveLength(1);

    const owner = await signUp('Self Owner');
    const projectId = await createProject(owner);
    const own = await createTask(owner, projectId, { assignee_id: owner.id });
    expect((await move(owner, own.id, 'done')).status).toBe(200);
    expect(await taskMovedNotices(owner)).toEqual([]);
  });

  it('skips a creator who lost project access and an account that was deleted', async () => {
    const { owner, creator, assignee, mover, projectId, task } = await board();
    expect((await callApi(owner, 'DELETE', `/api/projects/${projectId}/members/${creator.id}`)).status).toBe(200);

    expect((await move(mover, task.id, 'ongoing')).status).toBe(200);
    expect(await taskMovedNotices(creator)).toEqual([]);
    expect(await taskMovedNotices(assignee)).toHaveLength(1);

    const admin = await signUp('Deleting Admin');
    grantAdmin(admin.id);
    expect((await callApi(admin, 'DELETE', '/api/users', { ids: [assignee.id] })).status).toBe(200);
    expect((await move(mover, task.id, 'review')).status).toBe(200);
    expect(await taskMovedNotices(creator)).toEqual([]);
  });

  it('creates nothing for a refused move', async () => {
    const { creator, assignee, mover, task } = await board();
    const outsider = await signUp('Board Outsider');

    expect((await move(mover, task.id, 'backlog')).status).toBe(409);
    expect((await move(mover, task.id, 'revisi')).status).toBe(422);
    expect([403, 404]).toContain((await move(outsider, task.id, 'ongoing')).status);

    expect(await taskMovedNotices(creator)).toEqual([]);
    expect(await taskMovedNotices(assignee)).toEqual([]);
  });

  it('does not notify on task create, edit or delete', async () => {
    const { owner, creator, assignee, mover, task } = await board();

    const edited = await callApi(mover, 'PATCH', `/api/tasks/${task.id}`, { title: 'Ship the bell soon', revision: task.revision });
    expect(edited.status).toBe(200);
    expect((await callApi(owner, 'DELETE', `/api/tasks/${task.id}`)).status).toBe(200);

    for (const persona of [owner, creator, assignee, mover]) expect(await taskMovedNotices(persona)).toEqual([]);
  });

  it('announces notifications.changed only to the recipients', async () => {
    const { owner, creator, assignee, mover, task } = await board();
    const streams = new Map<Persona, EventReader>();
    for (const persona of [owner, creator, assignee, mover]) streams.set(persona, await listen(persona));

    expect((await move(mover, task.id, 'ongoing')).status).toBe(200);

    const seen = new Map<Persona, string[]>();
    for (const [persona, events] of streams) seen.set(persona, await drain(events));
    expect(seen.get(creator)).toContain(NOTIFICATIONS_CHANGED_EVENT);
    expect(seen.get(assignee)).toContain(NOTIFICATIONS_CHANGED_EVENT);
    expect(seen.get(mover)).not.toContain(NOTIFICATIONS_CHANGED_EVENT);
    expect(seen.get(owner)).not.toContain(NOTIFICATIONS_CHANGED_EVENT);
    expect(seen.get(creator)?.filter((event) => event === NOTIFICATIONS_CHANGED_EVENT)).toHaveLength(1);
  });
});
