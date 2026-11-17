import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { projectsResponseSchemas } from '../../index';

interface Entry {
  id: string;
  event_type: string;
  task_id: string | null;
  batch_id: string | null;
  task_title: string | null;
  batch_version: string | null;
  meta: Record<string, unknown> | null;
}

async function createProject(owner: Persona): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name: 'Apollo' });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function createTask(persona: Persona, projectId: string, title: string) {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title });
  expect(created.status).toBe(201);
  return created.body.data.task as { id: string; revision: number };
}

async function createBatch(persona: Persona, projectId: string, body: Record<string, unknown> = {}) {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/batches`, body);
  expect(created.status).toBe(201);
  return created.body.data.batch as { id: string; major: number; minor: number };
}

/** The project's activity, oldest first, parsed with the strict schema. */
async function activity(persona: Persona, projectId: string): Promise<Entry[]> {
  const listed = await callApi(persona, 'GET', `/api/projects/${projectId}/activity`);
  expect(listed.status).toBe(200);
  return projectsResponseSchemas().activity.parse(listed.body).data.activity.slice().reverse();
}

function insertLegacyActivity(projectId: string, row: { event_type: string; task_id?: string; batch_id?: string; meta?: string }): string {
  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO project_activity_logs (id, project_id, event_type, description, actor_id, task_id, batch_id, meta, created_at)
       VALUES (?, ?, ?, 'Legacy entry', NULL, ?, ?, ?, ?)`,
    )
    .run(id, projectId, row.event_type, row.task_id ?? null, row.batch_id ?? null, row.meta ?? null, Date.now() + 60_000);
  return id;
}

describe('activity names', () => {
  beforeEach(() => resetSecurityState());

  it('names the task each task event was about, as titled at the time', async () => {
    const owner = await signUp('Activity Owner');
    const projectId = await createProject(owner);
    const task = await createTask(owner, projectId, 'Draft the plan');
    expect((await callApi(owner, 'PATCH', `/api/tasks/${task.id}`, { title: 'Ship the plan', revision: task.revision })).status).toBe(200);
    expect((await callApi(owner, 'PATCH', `/api/tasks/${task.id}/move`, { column_id: 'ongoing' })).status).toBe(200);

    const entries = await activity(owner, projectId);
    expect(entries.map((entry) => [entry.event_type, entry.task_title, entry.batch_version])).toEqual([
      ['project.created', null, null],
      ['task.created', 'Draft the plan', null],
      ['task.updated', 'Ship the plan', null],
      ['task.moved', 'Ship the plan', null],
    ]);
  });

  it('keeps the title of a task that was deleted later', async () => {
    const owner = await signUp('Deleting Owner');
    const projectId = await createProject(owner);
    const task = await createTask(owner, projectId, 'Short-lived');
    expect((await callApi(owner, 'DELETE', `/api/tasks/${task.id}`)).status).toBe(200);

    const entries = await activity(owner, projectId);
    expect(entries.filter((entry) => entry.event_type.startsWith('task.')).map((entry) => [entry.event_type, entry.task_id, entry.task_title])).toEqual([
      ['task.created', null, 'Short-lived'],
      ['task.deleted', null, 'Short-lived'],
    ]);
  });

  it('names the batch version of batch.created and batch.activated', async () => {
    const owner = await signUp('Batch Owner');
    const projectId = await createProject(owner);
    const first = await createBatch(owner, projectId, { activate: true });
    const second = await createBatch(owner, projectId);
    expect((await callApi(owner, 'PATCH', `/api/projects/${projectId}/batches/${second.id}/activate`)).status).toBe(200);

    const entries = (await activity(owner, projectId)).filter((entry) => entry.event_type.startsWith('batch.'));
    expect(entries.map((entry) => [entry.event_type, entry.batch_version, entry.task_title])).toEqual([
      ['batch.created', `${first.major}.${first.minor}`, null],
      ['batch.activated', `${first.major}.${first.minor}`, null],
      ['batch.created', `${second.major}.${second.minor}`, null],
      ['batch.activated', `${second.major}.${second.minor}`, null],
    ]);
  });

  it('falls back to the current task title and batch version for rows recorded without them', async () => {
    const owner = await signUp('Legacy Owner');
    const projectId = await createProject(owner);
    const task = await createTask(owner, projectId, 'Current title');
    const batch = await createBatch(owner, projectId);
    const legacyTask = insertLegacyActivity(projectId, { event_type: 'task.moved', task_id: task.id, meta: '{"from":"backlog","to":"ongoing"}' });
    const legacyBatch = insertLegacyActivity(projectId, { event_type: 'batch.activated', batch_id: batch.id });
    const orphan = insertLegacyActivity(projectId, { event_type: 'task.deleted' });

    const byId = new Map((await activity(owner, projectId)).map((entry) => [entry.id, entry]));
    expect(byId.get(legacyTask)).toMatchObject({ task_title: 'Current title', batch_version: null });
    expect(byId.get(legacyBatch)).toMatchObject({ task_title: null, batch_version: `${batch.major}.${batch.minor}` });
    expect(byId.get(orphan)).toMatchObject({ task_title: null, batch_version: null });
  });

  it('carries both on the dashboard’s recent activity', async () => {
    const owner = await signUp('Dashboard Owner');
    const projectId = await createProject(owner);
    const batch = await createBatch(owner, projectId);
    await createTask(owner, projectId, 'On the dashboard');

    const dashboard = await callApi(owner, 'GET', '/api/dashboard');
    expect(dashboard.status).toBe(200);
    const recent = projectsResponseSchemas().dashboard.parse(dashboard.body).data.recent_activity;
    expect(recent.map((entry) => [entry.event_type, entry.task_title, entry.batch_version])).toEqual([
      ['task.created', 'On the dashboard', null],
      ['batch.created', null, `${batch.major}.${batch.minor}`],
      ['project.created', null, null],
    ]);
  });
});
