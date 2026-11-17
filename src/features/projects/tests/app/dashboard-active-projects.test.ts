import { beforeEach, describe, expect, it } from 'vitest';
import { resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { signUp, type Persona } from '../../../../app/tests/personas';
import { projectsResponseSchemas } from '../../index';

async function createProject(owner: Persona, name: string): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function createTask(persona: Persona, projectId: string, column: string, body: Record<string, unknown> = {}): Promise<void> {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: `In ${column}`, ...body });
  expect(created.status).toBe(201);
  if (column === 'backlog') return;
  const moved = await callApi(persona, 'PATCH', `/api/tasks/${created.body.data.task.id}/move`, {
    column_id: column,
    ...(column === 'revisi' ? { note: 'Again' } : {}),
  });
  expect(moved.status).toBe(200);
}

async function openBatch(owner: Persona, projectId: string, activate: boolean): Promise<string> {
  const created = await callApi(owner, 'POST', `/api/projects/${projectId}/batches`, { activate });
  expect(created.status).toBe(201);
  return created.body.data.batch.id;
}

async function stats(persona: Persona) {
  const dashboard = await callApi(persona, 'GET', '/api/dashboard');
  expect(dashboard.status).toBe(200);
  return projectsResponseSchemas().dashboard.parse(dashboard.body).data.stats;
}

/** The dashboard's active tasks, as the "Task aktif" card counts them. */
const activeTasks = (counts: { ongoing: number; revisi: number; review: number }) => counts.ongoing + counts.revisi + counts.review;

describe('dashboard active_project_count', () => {
  beforeEach(() => resetSecurityState());

  it('counts the visible projects holding the tasks the active task count counts', async () => {
    const owner = await signUp('Active Projects Owner');
    const stranger = await signUp('Active Projects Stranger');

    const loose = await createProject(owner, 'Batch-less ongoing');
    await createTask(owner, loose, 'ongoing');
    await createTask(owner, loose, 'review');

    const shipped = await createProject(owner, 'Done only');
    await createTask(owner, shipped, 'done');
    await createTask(owner, shipped, 'done');

    const waiting = await createProject(owner, 'Backlog only');
    await createTask(owner, waiting, 'backlog');

    const sprint = await createProject(owner, 'Active batch');
    await openBatch(owner, sprint, true);
    await createTask(owner, sprint, 'review');

    // A task of a batch that is not active counts toward the active tasks too, so its project counts.
    const planned = await createProject(owner, 'Planned batch');
    await openBatch(owner, planned, true);
    const plannedBatch = await openBatch(owner, planned, false);
    await createTask(owner, planned, 'revisi', { batch_id: plannedBatch });

    const hidden = await createProject(stranger, 'Not visible');
    await createTask(stranger, hidden, 'ongoing');

    const mine = await stats(owner);
    expect(activeTasks(mine.counts)).toBe(4);
    expect(mine.active_project_count).toBe(3);

    const theirs = await stats(stranger);
    expect(activeTasks(theirs.counts)).toBe(1);
    expect(theirs.active_project_count).toBe(1);
  });

  it('is 0 when no task is active', async () => {
    const owner = await signUp('Idle Owner');
    expect((await stats(owner)).active_project_count).toBe(0);

    const project = await createProject(owner, 'Quiet');
    await createTask(owner, project, 'backlog');
    await createTask(owner, project, 'done');
    const idle = await stats(owner);
    expect(activeTasks(idle.counts)).toBe(0);
    expect(idle.active_project_count).toBe(0);
  });
});
