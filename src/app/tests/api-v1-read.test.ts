import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../shared/database';
import { closeEventStreams } from '../../shared/realtime';
import { publicApiOperations, type PublicApiOperation } from '../openapi';
import { app, PUBLIC_API_PREFIX, resetSecurityState } from '../server';
import { callApi } from './api';
import { grantAdmin, issueApiToken, signUp, type Persona } from './personas';

/**
 * The public API's read endpoints through the composed application, called
 * with personal access tokens. Every successful answer is parsed with the
 * schema its operation documents, and the last case checks that each
 * documented read answered at least once; the write test covers the rest.
 */
const operations = publicApiOperations();
const answered = new Set<PublicApiOperation>();

function operationFor(method: string, url: string): PublicApiOperation {
  const path = new URL(url, 'http://localhost').pathname.slice(PUBLIC_API_PREFIX.length);
  const operation = operations.find(
    (candidate) => candidate.method === method && new RegExp(`^${candidate.path.replace(/:[^/]+/g, '[^/]+')}$`).test(path),
  );
  if (!operation) throw new Error(`No documented operation for ${method.toUpperCase()} ${url}`);
  return operation;
}

async function v1(token: string, url: string): Promise<{ status: number; body: any }> {
  const response = await app.request(`${PUBLIC_API_PREFIX}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (response.status === 200) {
    const operation = operationFor('get', `${PUBLIC_API_PREFIX}${url}`);
    operation.responses[200].parse(body);
    answered.add(operation);
  }
  return { status: response.status, body };
}

/** Every item of a list, page by page, and how many pages it took. */
async function everyPage(token: string, url: string, key: string, limit: number): Promise<{ items: any[]; pages: number }> {
  const items: any[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const separator = url.includes('?') ? '&' : '?';
    const page = await v1(token, `${url}${separator}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    expect(page.status).toBe(200);
    expect(page.body.data[key].length).toBeLessThanOrEqual(limit);
    items.push(...page.body.data[key]);
    cursor = page.body.data.next_cursor;
    pages += 1;
  } while (cursor);
  return { items, pages };
}

async function created<T = any>(persona: Persona, path: string, body: Record<string, unknown>): Promise<T> {
  const answer = await callApi(persona, 'POST', path, body);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return answer.body.data;
}

async function joinWorkspace(owner: Persona, workspaceId: string, invitee: Persona): Promise<void> {
  const { invitation } = await created(owner, `/api/workspaces/${workspaceId}/invitations`, { email: invitee.email });
  const { token } = getDatabase().prepare('SELECT token FROM workspace_invitations WHERE id = ?').get(invitation.id) as { token: string };
  expect((await callApi(invitee, 'POST', `/api/invitations/${token}/respond`, { action: 'accept' })).status).toBe(200);
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe('public API v1 reads', () => {
  let owner: Persona;
  let teammate: Persona;
  let direct: Persona;
  let outsider: Persona;
  const token: Record<'owner' | 'teammate' | 'direct' | 'outsider' | 'ownerWrite', string> = {} as never;
  let workspaceIds: string[];
  let project: { id: string };
  let personal: { id: string };
  let foreign: { id: string };
  let active: { id: string };
  let planned: { id: string };
  let foreignBatch: { id: string };
  let tasks: Array<{ id: string; updated_at: number }>;
  let base: number;

  beforeAll(async () => {
    resetSecurityState();
    owner = await signUp('V1 Owner');
    teammate = await signUp('V1 Teammate');
    direct = await signUp('V1 Direct');
    outsider = await signUp('V1 Outsider');
    // Sign-ups and token creation share the strict sensitive limit.
    resetSecurityState();
    token.owner = await issueApiToken(owner, 'read');
    token.ownerWrite = await issueApiToken(owner, 'write');
    token.teammate = await issueApiToken(teammate, 'read');
    token.direct = await issueApiToken(direct, 'read');
    token.outsider = await issueApiToken(outsider, 'read');

    workspaceIds = [];
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      workspaceIds.push((await created(owner, '/api/workspaces', { name })).workspace.id);
    }
    await joinWorkspace(owner, workspaceIds[0], teammate);

    project = (await created(owner, '/api/projects', { name: 'Team project', workspace_id: workspaceIds[0] })).project;
    personal = (await created(owner, '/api/projects', { name: 'Personal project' })).project;
    expect((await callApi(owner, 'POST', `/api/projects/${personal.id}/members`, { email: direct.email })).status).toBe(201);
    foreign = (await created(outsider, '/api/projects', { name: 'Foreign project' })).project;
    active = (await created(owner, `/api/projects/${project.id}/batches`, { label: 'Now', activate: true })).batch;
    planned = (await created(owner, `/api/projects/${project.id}/batches`, { label: 'Later' })).batch;
    foreignBatch = (await created(outsider, `/api/projects/${foreign.id}/batches`, { activate: true })).batch;

    // Tasks change at known moments, so `updated_since` has exact answers.
    base = Date.now() + 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'], now: base });
    tasks = [];
    const bodies = [
      { title: 'One', assignee_id: teammate.id },
      { title: 'Two' },
      { title: 'Three', batch_id: planned.id },
      { title: 'Four', assignee_id: teammate.id, batch_id: planned.id },
      { title: 'Five' },
    ];
    for (const [index, body] of bodies.entries()) {
      vi.setSystemTime(base + index * 1000);
      tasks.push((await created(owner, `/api/projects/${project.id}/tasks`, body)).task);
    }
    // The first task changes last: it moves to the end of the sync order.
    vi.setSystemTime(base + 10_000);
    expect((await callApi(owner, 'PATCH', `/api/tasks/${tasks[0].id}/move`, { column_id: 'ongoing' })).status).toBe(200);
    vi.useRealTimers();
    for (const [index, content] of ['First', 'Second', 'Third'].entries()) {
      await created(index === 1 ? teammate : owner, `/api/tasks/${tasks[1].id}/comments`, { content });
    }
  });

  // The public API's per-token limit would otherwise carry across cases.
  beforeEach(() => resetSecurityState());
  afterAll(() => {
    vi.useRealTimers();
    closeEventStreams();
  });

  it('lists the caller\'s workspaces newest first, page by page', async () => {
    const all = await v1(token.owner, '/workspaces?limit=100');
    expect(all.body.data.next_cursor).toBeNull();
    expect(ids(all.body.data.workspaces).sort()).toEqual([...workspaceIds].sort());
    expect(all.body.data.workspaces.map((workspace: { created_at: number }) => workspace.created_at)).toEqual(
      all.body.data.workspaces.map((workspace: { created_at: number }) => workspace.created_at).sort((left: number, right: number) => right - left),
    );

    const paged = await everyPage(token.owner, '/workspaces', 'workspaces', 2);
    expect(paged.pages).toBe(2);
    expect(ids(paged.items)).toEqual(ids(all.body.data.workspaces));

    expect(ids((await v1(token.teammate, '/workspaces')).body.data.workspaces)).toEqual([workspaceIds[0]]);
    expect((await v1(token.outsider, '/workspaces')).body.data).toEqual({ workspaces: [], next_cursor: null });
  });

  it('answers a workspace and its members only to its members', async () => {
    const workspace = await v1(token.teammate, `/workspaces/${workspaceIds[0]}`);
    expect(workspace.status).toBe(200);
    expect(workspace.body.data.workspace).toMatchObject({ id: workspaceIds[0], role: 'member', member_count: 2, project_count: 1 });

    const members = await v1(token.teammate, `/workspaces/${workspaceIds[0]}/members`);
    expect(members.body.data.members.map((member: { user: { id: string }; role: string }) => [member.user.id, member.role])).toEqual([
      [owner.id, 'owner'],
      [teammate.id, 'member'],
    ]);

    for (const path of [`/workspaces/${workspaceIds[0]}`, `/workspaces/${workspaceIds[0]}/members`]) {
      expect(await v1(token.outsider, path)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
      expect(await v1(token.outsider, path.replace(workspaceIds[0], 'missing'))).toMatchObject({
        status: 404,
        body: { code: 'WORKSPACE_NOT_FOUND' },
      });
    }
  });

  it('lists the projects the caller can open, by workspace and page by page', async () => {
    const all = (await v1(token.owner, '/projects')).body.data;
    expect(ids(all.projects).sort()).toEqual([project.id, personal.id].sort());
    expect(all.next_cursor).toBeNull();
    expect(ids((await everyPage(token.owner, '/projects', 'projects', 1)).items)).toEqual(ids(all.projects));

    expect(ids((await v1(token.owner, `/projects?workspace_id=${workspaceIds[0]}`)).body.data.projects)).toEqual([project.id]);
    expect(ids((await v1(token.teammate, '/projects')).body.data.projects)).toEqual([project.id]);
    expect(ids((await v1(token.direct, '/projects')).body.data.projects)).toEqual([personal.id]);
    expect(ids((await v1(token.outsider, '/projects')).body.data.projects)).toEqual([foreign.id]);
  });

  it('answers a project, its columns, batches and members to whoever can open it', async () => {
    const detail = (await v1(token.teammate, `/projects/${project.id}`)).body.data;
    expect(detail.project).toMatchObject({ id: project.id, role: 'member', task_counts: { backlog: 4, ongoing: 1 } });
    expect(detail.active_batch).toMatchObject({ id: active.id, is_active: true, total: 3 });

    const columns = (await v1(token.teammate, `/projects/${project.id}/columns`)).body.data.columns;
    expect(columns).toEqual([
      { id: 'backlog', name: 'Backlog', position: 0, task_count: 4 },
      { id: 'ongoing', name: 'On Going', position: 1, task_count: 1 },
      { id: 'revisi', name: 'Revisi', position: 2, task_count: 0 },
      { id: 'review', name: 'Review', position: 3, task_count: 0 },
      { id: 'done', name: 'Done', position: 4, task_count: 0 },
    ]);

    const batches = (await v1(token.teammate, `/projects/${project.id}/batches`)).body.data.batches;
    expect(ids(batches).sort()).toEqual([active.id, planned.id].sort());

    const members = (await v1(token.owner, `/projects/${project.id}/members`)).body.data.members;
    expect(members.map((member: { user: { id: string }; source: string }) => [member.user.id, member.source])).toEqual([
      [owner.id, 'project'],
      [teammate.id, 'workspace'],
    ]);
    const personalMembers = (await v1(token.direct, `/projects/${personal.id}/members`)).body.data.members;
    expect(personalMembers.map((member: { user: { id: string }; role: string }) => [member.user.id, member.role])).toEqual([
      [owner.id, 'owner'],
      [direct.id, 'member'],
    ]);

    for (const suffix of ['', '/columns', '/batches', '/members', '/tasks']) {
      expect(await v1(token.outsider, `/projects/${project.id}${suffix}`)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
      expect(await v1(token.outsider, `/projects/missing${suffix}`)).toMatchObject({ status: 404, body: { code: 'PROJECT_NOT_FOUND' } });
    }
  });

  it('lists tasks by last change, filtered and page by page', async () => {
    const all = (await v1(token.teammate, `/projects/${project.id}/tasks`)).body.data;
    expect(ids(all.tasks)).toEqual([tasks[1].id, tasks[2].id, tasks[3].id, tasks[4].id, tasks[0].id]);
    expect(all.next_cursor).toBeNull();

    const paged = await everyPage(token.teammate, `/projects/${project.id}/tasks`, 'tasks', 2);
    expect(paged.pages).toBe(3);
    expect(ids(paged.items)).toEqual(ids(all.tasks));

    const list = async (query: string) => ids((await v1(token.teammate, `/projects/${project.id}/tasks?${query}`)).body.data.tasks);
    expect(await list(`batch_id=${planned.id}`)).toEqual([tasks[2].id, tasks[3].id]);
    expect(await list('column_id=ongoing')).toEqual([tasks[0].id]);
    expect(await list(`assignee_id=${teammate.id}`)).toEqual([tasks[3].id, tasks[0].id]);
    expect(await list(`assignee_id=${teammate.id}&batch_id=${planned.id}`)).toEqual([tasks[3].id]);
    // Inclusive, so a change in the same millisecond as the last sync is not missed.
    expect(await list(`updated_since=${base + 3000}`)).toEqual([tasks[3].id, tasks[4].id, tasks[0].id]);
    expect(await list(`updated_since=${base + 10_001}`)).toEqual([]);
    expect(ids((await everyPage(token.teammate, `/projects/${project.id}/tasks?updated_since=${base + 2000}`, 'tasks', 1)).items)).toEqual([
      tasks[2].id,
      tasks[3].id,
      tasks[4].id,
      tasks[0].id,
    ]);
  });

  it('refuses a cursor, limit or filter it cannot read, and a batch of another project', async () => {
    const tasksOf = `/projects/${project.id}/tasks`;
    for (const query of ['cursor=not-a-cursor', `cursor=${Buffer.from('["x","y"]').toString('base64url')}`, 'limit=0', 'limit=101', 'limit=ten']) {
      const refused = await v1(token.owner, `${tasksOf}?${query}`);
      expect(refused, query).toMatchObject({ status: 422, body: { code: 'VALIDATION_ERROR' } });
      expect(Object.keys(refused.body.errors)).toEqual([query.split('=')[0]]);
    }
    expect(await v1(token.owner, `${tasksOf}?column_id=nowhere`)).toMatchObject({ status: 422, body: { code: 'VALIDATION_ERROR' } });
    expect(await v1(token.owner, `${tasksOf}?updated_since=-1`)).toMatchObject({ status: 422, body: { code: 'VALIDATION_ERROR' } });
    expect(await v1(token.owner, `/workspaces?cursor=bad`)).toMatchObject({ status: 422, body: { code: 'VALIDATION_ERROR' } });
    expect(await v1(token.owner, `${tasksOf}?batch_id=${foreignBatch.id}`)).toMatchObject({ status: 404, body: { code: 'BATCH_NOT_FOUND' } });
  });

  it('answers a task as the browser sees it, and its comments oldest first', async () => {
    const detail = await v1(token.teammate, `/tasks/${tasks[0].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toEqual((await callApi(teammate, 'GET', `/api/tasks/${tasks[0].id}`)).body.data);
    expect(detail.body.data.task.logs).toHaveLength(2);

    const comments = (await v1(token.teammate, `/tasks/${tasks[1].id}/comments`)).body.data;
    expect(comments.comments.map((comment: { content: string }) => comment.content)).toEqual(['First', 'Second', 'Third']);
    expect(comments.comments[1].user.id).toBe(teammate.id);
    const paged = await everyPage(token.teammate, `/tasks/${tasks[1].id}/comments`, 'comments', 2);
    expect(paged.pages).toBe(2);
    expect(ids(paged.items)).toEqual(ids(comments.comments));
    expect((await v1(token.teammate, `/tasks/${tasks[0].id}/comments`)).body.data).toEqual({ comments: [], next_cursor: null });

    for (const suffix of ['', '/comments']) {
      expect(await v1(token.outsider, `/tasks/${tasks[0].id}${suffix}`)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
      expect(await v1(token.outsider, `/tasks/missing${suffix}`)).toMatchObject({ status: 404, body: { code: 'TASK_NOT_FOUND' } });
    }
  });

  it('answers a write token the same as a read token', async () => {
    for (const path of ['/workspaces', `/projects/${project.id}`, `/projects/${project.id}/tasks`, `/tasks/${tasks[1].id}/comments`]) {
      const [read, write] = [await v1(token.owner, path), await v1(token.ownerWrite, path)];
      expect([read.status, write.status], path).toEqual([200, 200]);
      expect(write.body).toEqual(read.body);
    }
  });

  it('lists deleted tasks from the board and from the API, by deletion and page by page', async () => {
    const tasksPath = `/api/projects/${project.id}/tasks`;
    const doomed: Array<{ id: string }> = [];
    for (const title of ['Gone by board', 'Gone by API', 'Gone too']) doomed.push((await created(owner, tasksPath, { title })).task);
    const at = base + 20_000;
    vi.useFakeTimers({ toFake: ['Date'], now: at });
    try {
      expect((await callApi(owner, 'DELETE', `/api/tasks/${doomed[0].id}`)).status).toBe(200);
      vi.setSystemTime(at + 1000);
      const byApi = await app.request(`${PUBLIC_API_PREFIX}/tasks/${doomed[1].id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token.ownerWrite}` },
      });
      expect(byApi.status).toBe(200);
      expect((await callApi(owner, 'DELETE', `/api/tasks/${doomed[2].id}`)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    // Two deletions in the same millisecond are ordered by task id.
    const expected = [
      { id: doomed[0].id, deleted_at: at },
      ...[doomed[1].id, doomed[2].id].sort().map((id) => ({ id, deleted_at: at + 1000 })),
    ];

    const deletedPath = `/projects/${project.id}/tasks/deleted`;
    const all = await v1(token.owner, deletedPath);
    expect(all.status).toBe(200);
    expect(all.body.data).toEqual({ deleted: expected, next_cursor: null });
    expect((await everyPage(token.owner, `/projects/${project.id}/tasks`, 'tasks', 100)).items.map((task) => task.id)).not.toContain(doomed[0].id);

    // `since` is inclusive; `cursor` resumes after the last deletion a page returned.
    expect((await v1(token.owner, `${deletedPath}?since=${at + 1000}`)).body.data.deleted).toEqual(expected.slice(1));
    expect((await v1(token.owner, `${deletedPath}?since=${at + 1001}`)).body.data.deleted).toEqual([]);
    expect(await everyPage(token.owner, deletedPath, 'deleted', 1)).toEqual({ items: expected, pages: 3 });
    expect(await everyPage(token.owner, `${deletedPath}?since=${at}`, 'deleted', 2)).toEqual({ items: expected, pages: 2 });

    // The same access as the task list.
    expect((await v1(token.teammate, deletedPath)).body.data.deleted).toEqual(expected);
    expect(await v1(token.outsider, deletedPath)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(await v1(token.owner, `/projects/${foreign.id}/tasks/deleted`)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(await v1(token.owner, '/projects/f2a1c7de-0000-4000-8000-000000000000/tasks/deleted')).toMatchObject({
      status: 404,
      body: { code: 'PROJECT_NOT_FOUND' },
    });
    expect(await v1(token.owner, `${deletedPath}?since=-1`)).toMatchObject({ status: 422, body: { errors: { since: expect.anything() } } });
    expect((await v1(token.owner, `/projects/${personal.id}/tasks/deleted`)).body.data).toEqual({ deleted: [], next_cursor: null });
  });

  it('answered every documented read in its documented shape', () => {
    const reads = operations.filter((operation) => operation.method === 'get');
    expect(reads.filter((operation) => !answered.has(operation)).map((operation) => operation.path)).toEqual([]);
  });
});

describe('public API v1 sync of changes nobody edited', () => {
  it('lists the tasks a batch adopted, a lost member and a deleted account changed, as new revisions', async () => {
    resetSecurityState();
    const owner = await signUp('Sync Owner');
    const leaving = await signUp('Leaving Member');
    const deleted = await signUp('Deleted Account');
    const admin = await signUp('Sync Admin');
    grantAdmin(admin.id);
    const { project } = await created(owner, '/api/projects', { name: 'Sync' });
    for (const member of [leaving, deleted]) {
      expect((await callApi(owner, 'POST', `/api/projects/${project.id}/members`, { email: member.email })).status).toBe(201);
    }
    const tasksPath = `/api/projects/${project.id}/tasks`;
    const { task: left } = await created(owner, tasksPath, { title: 'Left behind', assignee_id: leaving.id });
    const { task: orphaned } = await created(owner, tasksPath, { title: 'Orphaned', assignee_id: deleted.id });
    const { task: adopted } = await created(owner, tasksPath, { title: 'Adopted' });
    const token = await issueApiToken(owner, 'read');

    /** A sync point after everything written so far, and what changed since it once `change` ran. */
    async function changedBy(change: () => Promise<{ status: number }>) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const since = Date.now();
      expect((await v1(token, `/projects/${project.id}/tasks?updated_since=${since}`)).body.data.tasks).toEqual([]);
      expect([200, 201]).toContain((await change()).status);
      return (await v1(token, `/projects/${project.id}/tasks?updated_since=${since}`)).body.data.tasks as Array<{
        id: string;
        batch_id: string | null;
        assignee: unknown;
        revision: number;
      }>;
    }

    // The project's first active batch adopts its batch-less tasks.
    const intoBatch = await changedBy(() => callApi(owner, 'POST', `/api/projects/${project.id}/batches`, { activate: true }));
    expect(intoBatch.map((task) => task.id).sort()).toEqual([left.id, orphaned.id, adopted.id].sort());
    expect(intoBatch.every((task) => task.batch_id !== null && task.revision === 2)).toBe(true);

    // A member who can no longer open the project comes off its tasks.
    const afterLeaving = await changedBy(() => callApi(owner, 'DELETE', `/api/projects/${project.id}/members/${leaving.id}`));
    expect(afterLeaving).toMatchObject([{ id: left.id, assignee: null, revision: 3 }]);

    // A deleted account comes off every task it was assigned.
    const afterDeletion = await changedBy(() => callApi(admin, 'DELETE', '/api/users', { ids: [deleted.id] }));
    expect(afterDeletion).toMatchObject([{ id: orphaned.id, assignee: null, revision: 3 }]);
  });
});
