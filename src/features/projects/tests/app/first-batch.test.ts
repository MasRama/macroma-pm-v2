import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { closeEventStreams, EVENTS_PATH, STREAM_READY_EVENT } from '../../../../shared/realtime';
import { readEvents, type EventReader } from '../../../../shared/realtime/tests/helpers';
import { PROJECTS_BOARD_CHANGED_EVENT, projectsResponseSchemas } from '../../index';

interface TaskView {
  id: string;
  title: string;
  batch_id: string | null;
  column_id: string;
  revision: number;
  revisi_count: number;
  version: { major: number; minor: number; patch: number };
}

const DAY = 24 * 60 * 60 * 1000;

const version = (task: TaskView) => `v${task.version.major}.${task.version.minor}.${task.version.patch}`;

async function createProject(owner: Persona): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name: 'Apollo' });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function createTask(persona: Persona, projectId: string, title: string): Promise<TaskView> {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title });
  expect(created.status).toBe(201);
  return created.body.data.task;
}

async function move(persona: Persona, taskId: string, column: string, note?: string): Promise<void> {
  const moved = await callApi(persona, 'PATCH', `/api/tasks/${taskId}/move`, { column_id: column, ...(note === undefined ? {} : { note }) });
  expect(moved.status).toBe(200);
}

async function openBatch(owner: Persona, projectId: string, body: Record<string, unknown>) {
  const created = await callApi(owner, 'POST', `/api/projects/${projectId}/batches`, body);
  expect(created.status).toBe(201);
  return created.body.data.batch as { id: string; major: number; minor: number; total: number };
}

async function activate(owner: Persona, projectId: string, batchId: string) {
  const activated = await callApi(owner, 'PATCH', `/api/projects/${projectId}/batches/${batchId}/activate`);
  expect(activated.status).toBe(200);
  return activated.body.data.batch as { id: string; total: number };
}

/** The meta of the project's batch activity entries, newest first. */
async function batchMeta(persona: Persona, projectId: string): Promise<Array<[string, string, unknown]>> {
  const activity = await callApi(persona, 'GET', `/api/projects/${projectId}/activity`);
  expect(activity.status).toBe(200);
  return activity.body.data.activity
    .filter((entry: { event_type: string }) => entry.event_type.startsWith('batch.'))
    .map((entry: { event_type: string; batch_id: string; meta: unknown }) => [entry.event_type, entry.batch_id, entry.meta]);
}

async function stats(persona: Persona) {
  const dashboard = await callApi(persona, 'GET', '/api/dashboard');
  expect(dashboard.status).toBe(200);
  return dashboard.body.data.stats as { done_this_week: number; done_last_week: number; revisi_repeated: number };
}

async function board(persona: Persona, projectId: string, batchId?: string): Promise<TaskView[]> {
  const listed = await callApi(persona, 'GET', `/api/projects/${projectId}/tasks${batchId ? `?batch_id=${batchId}` : ''}`);
  expect(listed.status).toBe(200);
  return projectsResponseSchemas().tasks.parse(listed.body).data.tasks as TaskView[];
}

async function listen(persona: Persona): Promise<EventReader> {
  const response = await app.request(EVENTS_PATH, { headers: { Cookie: persona.cookie } });
  expect(response.status).toBe(200);
  const events = readEvents(response);
  expect(await events.next()).toBe(STREAM_READY_EVENT);
  return events;
}

async function drain(events: EventReader, quietMs = 150): Promise<string[]> {
  const seen: string[] = [];
  for (let event = await events.next(quietMs); event !== 'timeout' && event !== 'closed'; event = await events.next(quietMs)) {
    seen.push(event);
  }
  return seen;
}

/** A project with three batch-less tasks: one in backlog, one moved to done, one moved to revisi. */
async function batchlessProject(owner: Persona) {
  const projectId = await createProject(owner);
  const backlog = await createTask(owner, projectId, 'Write the brief');
  const done = await createTask(owner, projectId, 'Pick the name');
  const revisi = await createTask(owner, projectId, 'Draw the logo');
  await move(owner, done.id, 'done');
  await move(owner, revisi.id, 'revisi', 'Bolder colours');
  const before = await board(owner, projectId);
  expect(before.every((task) => task.batch_id === null && task.version.major === 0 && task.version.minor === 0)).toBe(true);
  return { projectId, before, ids: [backlog.id, done.id, revisi.id] };
}

describe("a project's first activation", () => {
  beforeEach(() => resetSecurityState());
  afterEach(() => closeEventStreams());

  it('adopts the batch-less tasks as v0.1.1… in version order, on the active batch’s board', async () => {
    const owner = await signUp('First Batch Owner');
    const { projectId, before, ids } = await batchlessProject(owner);
    const [backlogId, doneId, revisiId] = ids;
    const byId = new Map(before.map((task) => [task.id, task]));

    const batch = await openBatch(owner, projectId, { activate: true });
    expect([batch.major, batch.minor, batch.total]).toEqual([0, 1, 3]);

    const adopted = await board(owner, projectId, batch.id);
    const adoptedById = new Map(adopted.map((task) => [task.id, task]));
    // Version order before: the backlog task kept v0.0.1, the moves took v0.0.4 (done) and v0.0.5 (revisi).
    expect(ids.map((id) => version(adoptedById.get(id) as TaskView))).toEqual(['v0.1.1', 'v0.1.2', 'v0.1.3']);
    for (const id of ids) {
      const task = adoptedById.get(id) as TaskView;
      const previous = byId.get(id) as TaskView;
      expect(task).toMatchObject({ batch_id: batch.id, column_id: previous.column_id, revision: previous.revision + 1 });
    }
    expect((adoptedById.get(revisiId) as TaskView).revisi_count).toBe(1);
    expect(await board(owner, projectId)).toHaveLength(3);

    const detail = await callApi(owner, 'GET', `/api/tasks/${doneId}`);
    const logs = projectsResponseSchemas().taskDetail.parse(detail.body.data.task).logs;
    expect(logs.at(-1)).toMatchObject({ version: 'v0.1.2', column_from: 'done', column_to: 'done', note: 'Moved into batch v0.1' });

    const activity = await callApi(owner, 'GET', `/api/projects/${projectId}/activity`);
    const created = activity.body.data.activity.find((entry: { event_type: string }) => entry.event_type === 'batch.created');
    expect(created).toMatchObject({ batch_id: batch.id, batch_version: '0.1', meta: { batch_version: '0.1', adopted_task_count: 3 } });

    // The batch counter continues after the adopted tasks.
    expect(version(await createTask(owner, projectId, 'Next one'))).toBe('v0.1.4');

    // The adoption is a version change, not a move: the dashboard still counts one task done this week.
    const dashboard = await callApi(owner, 'GET', '/api/dashboard');
    expect(dashboard.body.data.stats.done_this_week).toBe(1);
    expect(backlogId).toBeTruthy();
  });

  it('numbers them v1.0.1… when the first batch bumps the major version', async () => {
    const owner = await signUp('Major Batch Owner');
    const { projectId, ids } = await batchlessProject(owner);

    const batch = await openBatch(owner, projectId, { bump_major: true, activate: true });
    expect([batch.major, batch.minor]).toEqual([1, 0]);
    const adoptedById = new Map((await board(owner, projectId, batch.id)).map((task) => [task.id, task]));
    expect(ids.map((id) => version(adoptedById.get(id) as TaskView))).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3']);
  });

  it('tells the project’s pages to refetch the board', async () => {
    const owner = await signUp('Live Batch Owner');
    const { projectId } = await batchlessProject(owner);
    const events = await listen(owner);

    await openBatch(owner, projectId, { activate: true });
    expect(await drain(events)).toContain(PROJECTS_BOARD_CHANGED_EVENT);
  });

  it('adopts nothing when the first batch is created without activate', async () => {
    const owner = await signUp('Inactive Batch Owner');
    const { projectId } = await batchlessProject(owner);

    const batch = await openBatch(owner, projectId, {});
    expect(batch.total).toBe(0);
    expect((await board(owner, projectId)).every((task) => task.batch_id === null)).toBe(true);
    expect(await batchMeta(owner, projectId)).toEqual([['batch.created', batch.id, { batch_version: '0.1' }]]);
  });

  it('adopts on the first activation of an existing batch, tasks created after the batch included', async () => {
    const owner = await signUp('Later Activation Owner');
    const { projectId, ids } = await batchlessProject(owner);
    const batch = await openBatch(owner, projectId, {});
    const between = await createTask(owner, projectId, 'Created in between');
    expect(between.batch_id).toBeNull();
    const events = await listen(owner);

    expect((await activate(owner, projectId, batch.id)).total).toBe(4);
    const adoptedById = new Map((await board(owner, projectId, batch.id)).map((task) => [task.id, task]));
    expect([...ids, between.id].map((id) => version(adoptedById.get(id) as TaskView))).toEqual(['v0.1.1', 'v0.1.2', 'v0.1.3', 'v0.1.4']);
    expect(await board(owner, projectId)).toHaveLength(4);
    expect(await drain(events)).toContain(PROJECTS_BOARD_CHANGED_EVENT);

    expect(await batchMeta(owner, projectId)).toEqual([
      ['batch.activated', batch.id, { batch_version: '0.1', adopted_task_count: 4 }],
      ['batch.created', batch.id, { batch_version: '0.1' }],
    ]);
  });

  it('adopts nothing on a later activation of another batch', async () => {
    const owner = await signUp('Second Activation Owner');
    const projectId = await createProject(owner);
    const first = await openBatch(owner, projectId, { activate: true });
    const second = await openBatch(owner, projectId, {});
    // Batch-less tasks only arise before the first activation or from a V1 import.
    const loose = await createTask(owner, projectId, 'Outside any batch');
    getDatabase().prepare('UPDATE tasks SET batch_id = NULL WHERE id = ?').run(loose.id);

    expect((await activate(owner, projectId, second.id)).total).toBe(0);
    const [after] = await board(owner, projectId);
    expect(after).toMatchObject({ id: loose.id, batch_id: null, version: loose.version, revision: loose.revision });
    expect(await batchMeta(owner, projectId)).toEqual([
      ['batch.activated', second.id, { batch_version: '0.2' }],
      ['batch.created', second.id, { batch_version: '0.2' }],
      ['batch.activated', first.id, { batch_version: '0.1' }],
      ['batch.created', first.id, { batch_version: '0.1' }],
    ]);
  });

  it('keeps a task finished last week out of done_this_week after adopting it', async () => {
    const owner = await signUp('Done Last Week Owner');
    const projectId = await createProject(owner);
    const task = await createTask(owner, projectId, 'Old done');
    await move(owner, task.id, 'done');
    getDatabase().prepare('UPDATE task_logs SET created_at = created_at - ? WHERE task_id = ?').run(8 * DAY, task.id);
    const before = await stats(owner);

    await openBatch(owner, projectId, { activate: true });
    const after = await stats(owner);
    expect(after.done_this_week).toBe(before.done_this_week);
    expect(after.done_last_week).toBe(before.done_last_week);
  });

  it('does not count a task sent to revisi once as repeated after adopting it', async () => {
    const owner = await signUp('Revisi Once Owner');
    const projectId = await createProject(owner);
    const task = await createTask(owner, projectId, 'Once');
    await move(owner, task.id, 'revisi', 'fix');

    await openBatch(owner, projectId, { activate: true });
    expect((await stats(owner)).revisi_repeated).toBe(0);
  });
});
