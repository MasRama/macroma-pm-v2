import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { grantAdmin, signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';

interface Created {
  id: string;
  revision: number;
}

async function createProject(owner: Persona, body: Record<string, unknown> = {}): Promise<Created> {
  const created = await callApi(owner, 'POST', '/api/projects', { name: 'Apollo', description: 'Launch', ...body });
  expect(created.status).toBe(201);
  return created.body.data.project;
}

async function createWorkspace(owner: Persona): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/workspaces', { name: 'Team' });
  expect(created.status).toBe(201);
  return created.body.data.workspace.id;
}

async function joinWorkspace(owner: Persona, workspaceId: string, invitee: Persona): Promise<void> {
  const invited = await callApi(owner, 'POST', `/api/workspaces/${workspaceId}/invitations`, { email: invitee.email });
  const { token } = getDatabase().prepare('SELECT token FROM workspace_invitations WHERE id = ?').get(invited.body.data.invitation.id) as {
    token: string;
  };
  expect((await callApi(invitee, 'POST', `/api/invitations/${token}/respond`, { action: 'accept' })).status).toBe(200);
}

async function addMember(owner: Persona, projectId: string, member: Persona): Promise<void> {
  expect((await callApi(owner, 'POST', `/api/projects/${projectId}/members`, { email: member.email })).status).toBe(201);
}

async function createBatch(persona: Persona, projectId: string, body: Record<string, unknown> = {}) {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/batches`, body);
  expect(created.status).toBe(201);
  return created.body.data.batch as { id: string; major: number; minor: number; is_active: boolean };
}

async function createTask(persona: Persona, projectId: string, body: Record<string, unknown> = {}) {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Write docs', ...body });
  expect(created.status).toBe(201);
  return created.body.data.task as { id: string; revision: number; version: { major: number; minor: number; patch: number } };
}

async function move(persona: Persona, taskId: string, column: string, note?: string) {
  return callApi(persona, 'PATCH', `/api/tasks/${taskId}/move`, { column_id: column, ...(note === undefined ? {} : { note }) });
}

describe('projects', () => {
  // Registration shares the strict per-client limit; each case starts afresh.
  beforeEach(() => resetSecurityState());

  it('creates a project owned by its creator and shows it only to accounts that can open it', async () => {
    const owner = await signUp('Project Owner');
    const outsider = await signUp('Project Outsider');
    const project = await createProject(owner);

    const listed = await callApi(owner, 'GET', '/api/projects');
    expect(listed.body.data.projects).toEqual([
      expect.objectContaining({
        id: project.id,
        role: 'owner',
        workspace_id: null,
        active_batch: null,
        member_count: 1,
        task_counts: { backlog: 0, ongoing: 0, revisi: 0, review: 0, done: 0 },
      }),
    ]);
    expect((await callApi(outsider, 'GET', '/api/projects')).body.data.projects).toEqual([]);

    const shown = await callApi(owner, 'GET', `/api/projects/${project.id}`);
    expect(shown.body.data).toMatchObject({
      batches: [],
      active_batch: null,
      members: [{ user: { id: owner.id, email: owner.email }, role: 'owner', source: 'project' }],
    });
    expect((await callApi(outsider, 'GET', `/api/projects/${project.id}`)).status).toBe(403);
    expect(await callApi(owner, 'GET', `/api/projects/${randomUUID()}`)).toMatchObject({ status: 404, body: { code: 'PROJECT_NOT_FOUND' } });
    expect((await callApi(undefined, 'GET', '/api/projects')).status).toBe(401);
    expect((await callApi(owner, 'POST', '/api/projects', { name: ' ' })).status).toBe(422);
  });

  it('opens a workspace project to the workspace members and counts it on the workspace', async () => {
    const owner = await signUp('Workspace Project Owner');
    const teammate = await signUp('Workspace Teammate');
    const outsider = await signUp('Workspace Project Outsider');
    const workspaceId = await createWorkspace(owner);
    await joinWorkspace(owner, workspaceId, teammate);

    expect((await callApi(outsider, 'POST', '/api/projects', { name: 'Sneaky', workspace_id: workspaceId })).status).toBe(403);
    const project = await createProject(owner, { workspace_id: workspaceId });
    await createProject(owner, { name: 'Personal' });

    const teammateList = await callApi(teammate, 'GET', '/api/projects');
    expect(teammateList.body.data.projects).toEqual([expect.objectContaining({ id: project.id, role: 'member', member_count: 2 })]);
    const filtered = await callApi(owner, 'GET', `/api/projects?workspace_id=${workspaceId}`);
    expect(filtered.body.data.projects.map((entry: Created) => entry.id)).toEqual([project.id]);

    const shown = await callApi(teammate, 'GET', `/api/projects/${project.id}`);
    expect(shown.body.data.members).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ id: owner.id }), role: 'owner', source: 'project' }),
      expect.objectContaining({ user: expect.objectContaining({ id: teammate.id }), role: 'member', source: 'workspace' }),
    ]);
    expect((await callApi(outsider, 'GET', `/api/projects/${project.id}`)).status).toBe(403);

    const workspaces = await callApi(owner, 'GET', '/api/workspaces');
    expect(workspaces.body.data.workspaces[0]).toMatchObject({ id: workspaceId, project_count: 1 });
  });

  it('keeps the projects of a deleted workspace, without the workspace', async () => {
    const owner = await signUp('Detach Owner');
    const teammate = await signUp('Detach Teammate');
    const workspaceId = await createWorkspace(owner);
    await joinWorkspace(owner, workspaceId, teammate);
    const project = await createProject(owner, { workspace_id: workspaceId });

    expect((await callApi(owner, 'DELETE', `/api/workspaces/${workspaceId}`)).status).toBe(200);
    expect((await callApi(owner, 'GET', `/api/projects/${project.id}`)).body.data.project.workspace_id).toBeNull();
    expect((await callApi(teammate, 'GET', `/api/projects/${project.id}`)).status).toBe(403);
  });

  it('lets only the owner edit or delete, and refuses an edit based on an older revision', async () => {
    const owner = await signUp('Editing Project Owner');
    const member = await signUp('Editing Project Member');
    const project = await createProject(owner);
    await addMember(owner, project.id, member);

    expect((await callApi(member, 'PATCH', `/api/projects/${project.id}`, { revision: 1, name: 'Hijack' })).status).toBe(403);
    const saved = await callApi(owner, 'PATCH', `/api/projects/${project.id}`, { revision: 1, name: 'Renamed', description: '' });
    expect(saved.body.data.project).toMatchObject({ name: 'Renamed', description: null, revision: 2 });
    const stale = await callApi(owner, 'PATCH', `/api/projects/${project.id}`, { revision: 1, name: 'Stale' });
    expect(stale).toMatchObject({ status: 409, body: { code: 'STALE_REVISION', current: { name: 'Renamed', revision: 2 } } });
    expect((await callApi(owner, 'PATCH', `/api/projects/${project.id}`, { revision: 2 })).status).toBe(422);

    expect((await callApi(member, 'DELETE', `/api/projects/${project.id}`)).status).toBe(403);
    expect((await callApi(owner, 'DELETE', `/api/projects/${project.id}`)).status).toBe(200);
    expect((await callApi(owner, 'GET', `/api/projects/${project.id}`)).status).toBe(404);
  });

  it('adds and removes project members by the owner only', async () => {
    const owner = await signUp('Members Owner');
    const member = await signUp('Members Member');
    const other = await signUp('Members Other');
    const project = await createProject(owner);
    const path = `/api/projects/${project.id}/members`;

    expect(await callApi(owner, 'POST', path, { email: `${randomUUID()}@example.com` })).toMatchObject({
      status: 404,
      body: { code: 'ACCOUNT_NOT_FOUND' },
    });
    const added = await callApi(owner, 'POST', path, { email: member.email.toUpperCase() });
    expect(added).toMatchObject({ status: 201, body: { data: { member: { user: { id: member.id }, role: 'member', source: 'project' } } } });
    expect(await callApi(owner, 'POST', path, { email: member.email })).toMatchObject({ status: 409, body: { code: 'ALREADY_MEMBER' } });
    expect((await callApi(member, 'POST', path, { email: other.email })).status).toBe(403);
    expect((await callApi(member, 'GET', `/api/projects/${project.id}`)).status).toBe(200);

    expect(await callApi(owner, 'DELETE', `${path}/${owner.id}`)).toMatchObject({ status: 409, body: { code: 'OWNER_CANNOT_BE_REMOVED' } });
    expect(await callApi(owner, 'DELETE', `${path}/${other.id}`)).toMatchObject({ status: 404, body: { code: 'MEMBER_NOT_FOUND' } });
    expect((await callApi(member, 'DELETE', `${path}/${member.id}`)).status).toBe(403);
    expect((await callApi(owner, 'DELETE', `${path}/${member.id}`)).status).toBe(200);
    expect((await callApi(member, 'GET', `/api/projects/${project.id}`)).status).toBe(403);
  });

  it('opens batches with the next version and keeps exactly one active', async () => {
    const owner = await signUp('Batch Owner');
    const member = await signUp('Batch Member');
    const project = await createProject(owner);
    const otherProject = await createProject(owner, { name: 'Other' });
    await addMember(owner, project.id, member);

    const first = await createBatch(member, project.id, { label: 'Kickoff' });
    expect(first).toMatchObject({ major: 0, minor: 1, is_active: false, total: 0 });
    const second = await createBatch(member, project.id);
    expect(second).toMatchObject({ major: 0, minor: 2 });
    expect((await callApi(member, 'POST', `/api/projects/${project.id}/batches`, { activate: true })).status).toBe(403);
    const major = await createBatch(owner, project.id, { bump_major: true, activate: true });
    expect(major).toMatchObject({ major: 1, minor: 0, is_active: true });

    const activatePath = `/api/projects/${project.id}/batches/${first.id}/activate`;
    expect((await callApi(member, 'PATCH', activatePath)).status).toBe(403);
    expect((await callApi(owner, 'PATCH', activatePath)).body.data.batch).toMatchObject({ id: first.id, is_active: true });
    const foreign = await createBatch(owner, otherProject.id);
    expect(await callApi(owner, 'PATCH', `/api/projects/${project.id}/batches/${foreign.id}/activate`)).toMatchObject({
      status: 404,
      body: { code: 'BATCH_NOT_FOUND' },
    });

    const batches = (await callApi(member, 'GET', `/api/projects/${project.id}/batches`)).body.data.batches as Array<{
      id: string;
      major: number;
      minor: number;
      is_active: boolean;
    }>;
    expect(batches.map((batch) => [batch.major, batch.minor, batch.is_active])).toEqual([
      [1, 0, false],
      [0, 2, false],
      [0, 1, true],
    ]);
    const shown = await callApi(member, 'GET', `/api/projects/${project.id}`);
    expect(shown.body.data.active_batch).toMatchObject({ id: first.id, label: 'Kickoff' });
    expect(shown.body.data.project.active_batch).toEqual({ id: first.id, major: 0, minor: 1, label: 'Kickoff' });
  });

  it('versions tasks from the project counter and logs every move', async () => {
    const owner = await signUp('Task Owner');
    const member = await signUp('Task Member');
    const outsider = await signUp('Task Outsider');
    const project = await createProject(owner);
    await addMember(owner, project.id, member);
    const batch = await createBatch(owner, project.id, { activate: true });

    const task = await createTask(member, project.id, { priority: 'high', assignee_id: member.id });
    expect(task).toMatchObject({
      batch_id: batch.id,
      column_id: 'backlog',
      priority: 'high',
      version: { major: 0, minor: 1, patch: 1 },
      revisi_count: 0,
      assignee: { id: member.id, name: member.name, avatar: null },
    });
    expect(await callApi(member, 'POST', `/api/projects/${project.id}/tasks`, { title: 'X', assignee_id: outsider.id })).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_ERROR', errors: { assignee_id: expect.any(Array) } },
    });
    expect((await callApi(outsider, 'POST', `/api/projects/${project.id}/tasks`, { title: 'X' })).status).toBe(403);

    expect((await move(member, task.id, 'revisi')).status).toBe(422);
    expect(await move(member, task.id, 'backlog')).toMatchObject({ status: 409, body: { code: 'TASK_ALREADY_IN_COLUMN' } });
    const moved = await move(member, task.id, 'ongoing');
    expect(moved.body.data).toMatchObject({
      task: { column_id: 'ongoing', version: { patch: 2 } },
      log: { version: 'v0.1.2', column_from: 'backlog', column_to: 'ongoing', note: '', user: { id: member.id } },
    });
    expect((await move(owner, task.id, 'review')).status).toBe(200);
    expect((await move(owner, task.id, 'revisi', 'Fix the header')).status).toBe(200);
    expect((await move(member, task.id, 'review')).status).toBe(200);
    expect((await move(owner, task.id, 'revisi', 'Still off')).status).toBe(200);
    expect((await move(outsider, task.id, 'done')).status).toBe(403);

    const detail = await callApi(member, 'GET', `/api/tasks/${task.id}`);
    expect(detail.body.data.task).toMatchObject({
      column_id: 'revisi',
      revisi_count: 2,
      version: { major: 0, minor: 1, patch: 6 },
      project: { id: project.id, name: 'Apollo' },
      batch: { id: batch.id, major: 0, minor: 1 },
      created_by: { id: member.id },
    });
    expect(detail.body.data.task.logs.map((log: { column_to: string; version: string }) => [log.column_to, log.version])).toEqual([
      ['backlog', 'v0.1.1'],
      ['ongoing', 'v0.1.2'],
      ['review', 'v0.1.3'],
      ['revisi', 'v0.1.4'],
      ['review', 'v0.1.5'],
      ['revisi', 'v0.1.6'],
    ]);
    expect((await callApi(member, 'GET', `/api/tasks/${task.id}/logs`)).body.data.logs).toHaveLength(6);
    expect(await callApi(member, 'GET', `/api/tasks/${randomUUID()}`)).toMatchObject({ status: 404, body: { code: 'TASK_NOT_FOUND' } });
    expect((await callApi(outsider, 'GET', `/api/tasks/${task.id}`)).status).toBe(403);
  });

  it('derives the revisi count and batch counts for a whole board in one response', async () => {
    const owner = await signUp('Board Owner');
    const project = await createProject(owner);
    const first = await createBatch(owner, project.id, { activate: true });
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) ids.push((await createTask(owner, project.id, { title: `Task ${index}` })).id);
    const second = await createBatch(owner, project.id, { activate: true });
    const late = await createTask(owner, project.id, { title: 'Late' });
    const pinned = await createTask(owner, project.id, { title: 'Pinned', batch_id: first.id });

    for (let round = 0; round < 3; round += 1) {
      await move(owner, ids[0], 'revisi', `Round ${round}`);
      await move(owner, ids[0], 'review');
    }
    await move(owner, ids[1], 'revisi', 'Once');
    await move(owner, ids[2], 'done');
    await move(owner, late.id, 'ongoing');

    const board = await callApi(owner, 'GET', `/api/projects/${project.id}/tasks`);
    const byId = new Map((board.body.data.tasks as Array<{ id: string; revisi_count: number }>).map((task) => [task.id, task]));
    expect(byId.size).toBe(8);
    expect(byId.get(ids[0])?.revisi_count).toBe(3);
    expect(byId.get(ids[1])?.revisi_count).toBe(1);
    expect(byId.get(ids[2])?.revisi_count).toBe(0);

    const firstBoard = await callApi(owner, 'GET', `/api/projects/${project.id}/tasks?batch_id=${first.id}`);
    expect(firstBoard.body.data.tasks.map((task: { id: string }) => task.id).sort()).toEqual([...ids, pinned.id].sort());
    expect(await callApi(owner, 'GET', `/api/projects/${project.id}/tasks?batch_id=${randomUUID()}`)).toMatchObject({
      status: 404,
      body: { code: 'BATCH_NOT_FOUND' },
    });

    const batches = (await callApi(owner, 'GET', `/api/projects/${project.id}/batches`)).body.data.batches as Array<{
      id: string;
      counts: Record<string, number>;
      total: number;
    }>;
    expect(batches.find((batch) => batch.id === first.id)).toMatchObject({
      counts: { backlog: 4, ongoing: 0, revisi: 1, review: 1, done: 1 },
      total: 7,
    });
    expect(batches.find((batch) => batch.id === second.id)).toMatchObject({
      counts: { backlog: 0, ongoing: 1, revisi: 0, review: 0, done: 0 },
      total: 1,
    });
    const listed = await callApi(owner, 'GET', '/api/projects');
    expect(listed.body.data.projects[0].task_counts).toEqual({ backlog: 4, ongoing: 1, revisi: 1, review: 1, done: 1 });
  });

  it('edits a task with its revision and lets only the owner delete it', async () => {
    const owner = await signUp('Edit Task Owner');
    const member = await signUp('Edit Task Member');
    const outsider = await signUp('Edit Task Outsider');
    const project = await createProject(owner);
    await addMember(owner, project.id, member);
    const task = await createTask(member, project.id);

    const saved = await callApi(member, 'PATCH', `/api/tasks/${task.id}`, {
      revision: 1,
      title: 'Write better docs',
      description: 'With examples',
      priority: 'low',
      assignee_id: owner.id,
    });
    expect(saved.body.data.task).toMatchObject({
      title: 'Write better docs',
      description: 'With examples',
      priority: 'low',
      assignee: { id: owner.id },
      revision: 2,
      version: task.version,
    });
    const stale = await callApi(member, 'PATCH', `/api/tasks/${task.id}`, { revision: 1, title: 'Stale' });
    expect(stale).toMatchObject({ status: 409, body: { code: 'STALE_REVISION', current: { title: 'Write better docs', revision: 2 } } });
    expect((await callApi(member, 'PATCH', `/api/tasks/${task.id}`, { revision: 2, assignee_id: outsider.id })).status).toBe(422);
    const unassigned = await callApi(member, 'PATCH', `/api/tasks/${task.id}`, { revision: 2, assignee_id: null });
    expect(unassigned.body.data.task).toMatchObject({ assignee: null, revision: 3 });
    expect((await callApi(member, 'PATCH', `/api/tasks/${task.id}`, { revision: 3 })).status).toBe(422);

    expect((await callApi(member, 'DELETE', `/api/tasks/${task.id}`)).status).toBe(403);
    expect((await callApi(owner, 'DELETE', `/api/tasks/${task.id}`)).status).toBe(200);
    expect((await callApi(owner, 'GET', `/api/tasks/${task.id}`)).status).toBe(404);
  });

  it('records the project activity with its actors, newest first', async () => {
    const owner = await signUp('Activity Owner');
    const project = await createProject(owner);
    await createBatch(owner, project.id, { label: 'Alpha', activate: true });
    const task = await createTask(owner, project.id, { title: 'Ship' });
    await move(owner, task.id, 'ongoing');

    const activity = await callApi(owner, 'GET', `/api/projects/${project.id}/activity`);
    const entries = activity.body.data.activity as Array<{ event_type: string; meta: unknown; actor: unknown; description: string }>;
    expect(entries.map((entry) => entry.event_type)).toEqual([
      'task.moved',
      'task.created',
      'batch.activated',
      'batch.created',
      'project.created',
    ]);
    expect(entries[0]).toMatchObject({
      description: 'Task "Ship" moved from Backlog to On Going (v0.1.2)',
      meta: { from: 'backlog', to: 'ongoing', version: 'v0.1.2' },
      actor: { id: owner.id, name: owner.name, avatar: null },
    });
  });

  it('forgets deleted accounts: their projects go and their names come off tasks', async () => {
    const admin = await signUp('Project Account Admin');
    grantAdmin(admin.id);
    const owner = await signUp('Deleted Project Owner');
    const member = await signUp('Surviving Member');
    const assignee = await signUp('Deleted Assignee');
    const doomed = await createProject(owner);
    await addMember(owner, doomed.id, member);
    const kept = await createProject(member, { name: 'Kept' });
    await addMember(member, kept.id, assignee);
    const task = await createTask(assignee, kept.id, { assignee_id: assignee.id });

    expect((await callApi(admin, 'DELETE', '/api/users', { ids: [owner.id, assignee.id] })).status).toBe(200);
    expect((await callApi(member, 'GET', `/api/projects/${doomed.id}`)).status).toBe(404);
    const detail = await callApi(member, 'GET', `/api/tasks/${task.id}`);
    expect(detail.body.data.task).toMatchObject({ assignee: null, created_by: null });
    expect((await callApi(member, 'GET', `/api/projects/${kept.id}`)).body.data.members).toHaveLength(1);
  });
});
