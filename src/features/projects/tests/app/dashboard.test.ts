import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';

const DAY = 24 * 60 * 60 * 1000;

async function createProject(owner: Persona, body: Record<string, unknown>): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', body);
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function createTask(persona: Persona, projectId: string, body: Record<string, unknown> = {}): Promise<string> {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Dashboard task', ...body });
  expect(created.status).toBe(201);
  return created.body.data.task.id;
}

async function move(persona: Persona, taskId: string, column: string): Promise<void> {
  expect((await callApi(persona, 'PATCH', `/api/tasks/${taskId}/move`, { column_id: column, note: 'Dashboard move' })).status).toBe(200);
}

/** The local calendar date, as the dashboard names its days. */
function isoDay(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const zeroCounts = { backlog: 0, ongoing: 0, revisi: 0, review: 0, done: 0 };

describe('dashboard', () => {
  beforeEach(() => resetSecurityState());

  it('sums up the projects the account can open', async () => {
    const owner = await signUp('Dashboard Owner');
    const outsider = await signUp('Dashboard Outsider');
    const workspace = await callApi(owner, 'POST', '/api/workspaces', { name: 'Dashboard Team' });
    const workspaceId = workspace.body.data.workspace.id as string;

    const alpha = await createProject(owner, { name: 'Alpha', workspace_id: workspaceId });
    const unbatched = await createTask(owner, alpha);
    const batch = await callApi(owner, 'POST', `/api/projects/${alpha}/batches`, { label: 'Sprint', activate: true });
    const batchId = batch.body.data.batch.id as string;
    const shipped = await createTask(owner, alpha, { title: 'Shipped' });
    await move(owner, shipped, 'done');
    const mine = await createTask(owner, alpha, { title: 'Mine', assignee_id: owner.id });
    await move(owner, mine, 'ongoing');
    const bounced = await createTask(owner, alpha, { title: 'Bounced' });
    await move(owner, bounced, 'revisi');
    await move(owner, bounced, 'review');
    await move(owner, bounced, 'revisi');
    await createTask(owner, alpha, { title: 'Waiting' });

    const beta = await createProject(owner, { name: 'Beta' });
    await createTask(owner, beta, { title: 'Beta backlog' });
    const lastWeek = await createTask(owner, beta, { title: 'Finished last week' });
    await move(owner, lastWeek, 'done');
    const database = getDatabase();
    database.prepare('UPDATE task_logs SET created_at = ? WHERE task_id = ? AND column_from IS NULL').run(Date.now() - 12 * DAY, lastWeek);
    database.prepare("UPDATE task_logs SET created_at = ? WHERE task_id = ? AND column_to = 'done'").run(Date.now() - 10 * DAY, lastWeek);

    const hidden = await createProject(outsider, { name: 'Hidden' });
    await createTask(outsider, hidden, { title: 'Not for the owner' });

    const dashboard = await callApi(owner, 'GET', '/api/dashboard');
    expect(dashboard.status).toBe(200);
    const data = dashboard.body.data;

    expect(data.stats).toEqual({
      workspace_count: 1,
      project_count: 2,
      counts: { backlog: 3, ongoing: 1, revisi: 1, review: 0, done: 2 },
      total: 7,
      done_this_week: 1,
      done_last_week: 1,
      ongoing_mine: 1,
      revisi_repeated: 1,
    });

    expect(data.trends).toHaveLength(7);
    expect(data.trends.map((day: { day: string }) => day.day)).toEqual(
      Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        return isoDay(date.getTime());
      }),
    );
    // Before today only Beta's backdated task existed, already done; the projects were created today.
    expect(data.trends[0]).toMatchObject({ workspace: 0, project: 0, active: 0, done: 1 });
    expect(data.trends[6]).toMatchObject({ workspace: 1, project: 2, active: 2, done: 2 });

    expect(data.tasks_per_project).toEqual([
      { project_id: alpha, name: 'Alpha', count: 5 },
      { project_id: beta, name: 'Beta', count: 2 },
    ]);

    expect(data.board_health).toEqual(
      expect.arrayContaining([
        {
          project_id: alpha,
          name: 'Alpha',
          workspace_id: workspaceId,
          active_batch: { id: batchId, major: 0, minor: 1, label: 'Sprint' },
          counts: { backlog: 1, ongoing: 1, revisi: 1, review: 0, done: 1 },
          total: 4,
          done: 1,
        },
        {
          project_id: beta,
          name: 'Beta',
          workspace_id: null,
          active_batch: null,
          counts: { ...zeroCounts, backlog: 1, done: 1 },
          total: 2,
          done: 1,
        },
      ]),
    );
    expect(data.board_health).toHaveLength(2);
    expect(unbatched).toBeTruthy();

    expect(data.recent_activity).toHaveLength(8);
    expect(data.recent_activity.every((entry: { project_id: string }) => [alpha, beta].includes(entry.project_id))).toBe(true);
    const times = data.recent_activity.map((entry: { created_at: number }) => entry.created_at);
    expect(times).toEqual([...times].sort((left: number, right: number) => right - left));
    const moved = data.recent_activity.find((entry: { event_type: string }) => entry.event_type === 'task.moved');
    expect(moved).toMatchObject({
      actor: { id: owner.id, name: owner.name, avatar: null },
      meta: { from: expect.any(String), to: expect.any(String), version: expect.stringMatching(/^v\d+\.\d+\.\d+$/) },
    });

    expect(data.projects).toEqual([
      { id: beta, name: 'Beta', workspace_id: null },
      { id: alpha, name: 'Alpha', workspace_id: workspaceId },
    ]);
  });

  it('answers an account without projects with empty parts', async () => {
    const newcomer = await signUp('Dashboard Newcomer');
    const dashboard = await callApi(newcomer, 'GET', '/api/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data).toMatchObject({
      stats: {
        workspace_count: 0,
        project_count: 0,
        counts: zeroCounts,
        total: 0,
        done_this_week: 0,
        done_last_week: 0,
        ongoing_mine: 0,
        revisi_repeated: 0,
      },
      tasks_per_project: [],
      board_health: [],
      recent_activity: [],
      projects: [],
    });
    expect(dashboard.body.data.trends.map(({ day: _day, ...values }: { day: string }) => values)).toEqual(
      Array.from({ length: 7 }, () => ({ workspace: 0, project: 0, active: 0, done: 0 })),
    );
  });

  it('refuses a signed-out request', async () => {
    expect((await app.request('/api/dashboard')).status).toBe(401);
  });
});
