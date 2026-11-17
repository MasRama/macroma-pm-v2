import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';

const DAY = 24 * 60 * 60 * 1000;

async function createProject(owner: Persona, name = 'Releases'): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

/** Opens a batch and dates its opening `daysAgo` days back, so the closing dates are known. */
async function openBatch(owner: Persona, projectId: string, daysAgo: number, body: Record<string, unknown> = {}): Promise<string> {
  const created = await callApi(owner, 'POST', `/api/projects/${projectId}/batches`, body);
  expect(created.status).toBe(201);
  const id = created.body.data.batch.id as string;
  getDatabase().prepare('UPDATE project_batches SET created_at = ? WHERE id = ?').run(Date.now() - daysAgo * DAY, id);
  return id;
}

function openedAt(batchId: string): number {
  return (getDatabase().prepare('SELECT created_at FROM project_batches WHERE id = ?').get(batchId) as { created_at: number }).created_at;
}

async function createTask(persona: Persona, projectId: string, body: Record<string, unknown>): Promise<string> {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Release task', ...body });
  expect(created.status).toBe(201);
  return created.body.data.task.id;
}

async function move(persona: Persona, taskId: string, column: string): Promise<void> {
  const moved = await callApi(persona, 'PATCH', `/api/tasks/${taskId}/move`, { column_id: column, note: 'Moved for the release' });
  expect(moved.status).toBe(200);
}

describe('project releases', () => {
  beforeEach(() => resetSecurityState());

  it('lists the active batch with its progress and the other batches newest first, with closing dates and major bumps', async () => {
    const owner = await signUp('Release Owner');
    const projectId = await createProject(owner);
    const first = await openBatch(owner, projectId, 10, { label: 'Launch', activate: true });
    const second = await openBatch(owner, projectId, 6.5);
    const major = await openBatch(owner, projectId, 4, { bump_major: true });
    const active = await openBatch(owner, projectId, 1, { activate: true });
    await createTask(owner, projectId, { batch_id: first });
    for (let index = 0; index < 3; index += 1) await createTask(owner, projectId, {});
    const shipped = await createTask(owner, projectId, {});
    await move(owner, shipped, 'done');

    const releases = await callApi(owner, 'GET', `/api/projects/${projectId}/releases`);
    expect(releases.status).toBe(200);
    expect(releases.body.data.active).toEqual({
      id: active,
      major: 1,
      minor: 1,
      label: null,
      opened_at: openedAt(active),
      counts: { backlog: 3, ongoing: 0, revisi: 0, review: 0, done: 1 },
      total: 4,
      done: 1,
      progress: 25,
    });
    expect(releases.body.data.closed).toEqual([
      { id: major, major: 1, minor: 0, label: null, opened_at: openedAt(major), closed_at: openedAt(active), task_count: 0, major_bump: true },
      { id: second, major: 0, minor: 2, label: null, opened_at: openedAt(second), closed_at: openedAt(major), task_count: 0, major_bump: false },
      {
        id: first,
        major: 0,
        minor: 1,
        label: 'Launch',
        opened_at: openedAt(first),
        closed_at: openedAt(second),
        task_count: 1,
        major_bump: false,
      },
    ]);
  });

  it('answers no active batch, and a batch with no later one has no closing date', async () => {
    const owner = await signUp('Unreleased Owner');
    const projectId = await createProject(owner);
    expect((await callApi(owner, 'GET', `/api/projects/${projectId}/releases`)).body.data).toEqual({ active: null, closed: [] });
    const only = await openBatch(owner, projectId, 2);
    const releases = await callApi(owner, 'GET', `/api/projects/${projectId}/releases`);
    expect(releases.body.data.active).toBeNull();
    expect(releases.body.data.closed).toEqual([
      { id: only, major: 0, minor: 1, label: null, opened_at: openedAt(only), closed_at: null, task_count: 0, major_bump: false },
    ]);
  });

  it('gives one batch its changelog, stats and contributors', async () => {
    const owner = await signUp('Changelog Owner');
    const member = await signUp('Changelog Member');
    const helper = await signUp('Changelog Helper');
    const projectId = await createProject(owner);
    for (const persona of [member, helper]) {
      expect((await callApi(owner, 'POST', `/api/projects/${projectId}/members`, { email: persona.email })).status).toBe(201);
    }
    const batch = await openBatch(owner, projectId, 5.5, { label: 'Spring', activate: true });
    const fixed = await createTask(owner, projectId, { title: 'Fix login', priority: 'high', assignee_id: member.id });
    await move(member, fixed, 'review');
    await move(member, fixed, 'revisi');
    await move(member, fixed, 'review');
    await move(owner, fixed, 'revisi');
    const polished = await createTask(owner, projectId, { title: 'Polish board', assignee_id: helper.id });
    await move(owner, polished, 'revisi');
    const untouched = await createTask(owner, projectId, { title: 'Write notes' });
    const next = await openBatch(owner, projectId, 2);
    await createTask(owner, projectId, { title: 'Elsewhere', batch_id: next, assignee_id: member.id });

    const detail = await callApi(member, 'GET', `/api/projects/${projectId}/releases/${batch}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.batch).toEqual({
      id: batch,
      major: 0,
      minor: 1,
      label: 'Spring',
      opened_at: openedAt(batch),
      closed_at: null,
      task_count: 3,
      major_bump: false,
      is_active: true,
    });
    expect(detail.body.data.stats).toEqual({ task_count: 3, duration_days: null, revisi_task_count: 2 });
    expect(detail.body.data.changelog).toEqual([
      {
        task_id: fixed,
        title: 'Fix login',
        priority: 'high',
        version: { major: 0, minor: 1, patch: 5 },
        assignee: { id: member.id, name: member.name, avatar: null },
        column_id: 'revisi',
      },
      {
        task_id: untouched,
        title: 'Write notes',
        priority: 'medium',
        version: { major: 0, minor: 1, patch: 8 },
        assignee: null,
        column_id: 'backlog',
      },
      {
        task_id: polished,
        title: 'Polish board',
        priority: 'medium',
        version: { major: 0, minor: 1, patch: 7 },
        assignee: { id: helper.id, name: helper.name, avatar: null },
        column_id: 'revisi',
      },
    ].sort((left, right) => right.version.patch - left.version.patch));
    expect(detail.body.data.contributors).toEqual([
      { user: { id: owner.id, name: owner.name, email: owner.email, avatar: null }, task_count: 3 },
      { user: { id: helper.id, name: helper.name, email: helper.email, avatar: null }, task_count: 1 },
      { user: { id: member.id, name: member.name, email: member.email, avatar: null }, task_count: 1 },
    ].sort((left, right) => right.task_count - left.task_count || left.user.name.localeCompare(right.user.name)));

    // Once the owner activates the next batch, this one is closed by the next batch's opening.
    expect((await callApi(owner, 'PATCH', `/api/projects/${projectId}/batches/${next}/activate`)).status).toBe(200);
    const closed = await callApi(owner, 'GET', `/api/projects/${projectId}/releases/${batch}`);
    expect(closed.body.data.batch).toMatchObject({ is_active: false, closed_at: openedAt(next) });
    expect(closed.body.data.stats).toEqual({ task_count: 3, duration_days: 4, revisi_task_count: 2 });
  });

  it('answers an empty batch with empty parts', async () => {
    const owner = await signUp('Empty Batch Owner');
    const projectId = await createProject(owner);
    const empty = await openBatch(owner, projectId, 3.5);
    await openBatch(owner, projectId, 1);
    const detail = await callApi(owner, 'GET', `/api/projects/${projectId}/releases/${empty}`);
    expect(detail.body.data).toMatchObject({
      batch: { id: empty, task_count: 0, is_active: false },
      stats: { task_count: 0, duration_days: 3, revisi_task_count: 0 },
      changelog: [],
      contributors: [],
    });
  });

  it('refuses outsiders, absent projects and batches of another project', async () => {
    const owner = await signUp('Guarded Release Owner');
    const outsider = await signUp('Release Outsider');
    const projectId = await createProject(owner);
    const otherProject = await createProject(owner, 'Other');
    const foreign = await openBatch(owner, otherProject, 1);

    expect((await callApi(outsider, 'GET', `/api/projects/${projectId}/releases`)).status).toBe(403);
    expect((await callApi(outsider, 'GET', `/api/projects/${otherProject}/releases/${foreign}`)).status).toBe(403);
    expect((await callApi(owner, 'GET', `/api/projects/${randomUUID()}/releases`)).body).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(await callApi(owner, 'GET', `/api/projects/${projectId}/releases/${foreign}`)).toMatchObject({
      status: 404,
      body: { code: 'BATCH_NOT_FOUND' },
    });
    expect((await callApi(owner, 'GET', `/api/projects/${projectId}/releases/${randomUUID()}`)).status).toBe(404);
  });
});
