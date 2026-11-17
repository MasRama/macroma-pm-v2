import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { closeEventStreams, EVENTS_PATH, STREAM_READY_EVENT } from '../../../../shared/realtime';
import { readEvents, type EventReader } from '../../../../shared/realtime/tests/helpers';
import { PROJECTS_BOARD_CHANGED_EVENT, PROJECTS_CHANGED_EVENT } from '../../contract';

type Version = { major: number; minor: number; patch: number };

async function createProject(owner: Persona, body: Record<string, unknown> = {}): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name: 'Versions', ...body });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function createBatch(owner: Persona, projectId: string, body: Record<string, unknown> = {}): Promise<string> {
  const created = await callApi(owner, 'POST', `/api/projects/${projectId}/batches`, body);
  expect(created.status).toBe(201);
  return created.body.data.batch.id;
}

async function createTask(persona: Persona, projectId: string, body: Record<string, unknown> = {}) {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Versioned', ...body });
  expect(created.status).toBe(201);
  return created.body.data.task as { id: string; batch_id: string | null; version: Version };
}

async function move(persona: Persona, taskId: string, column: string): Promise<Version> {
  const moved = await callApi(persona, 'PATCH', `/api/tasks/${taskId}/move`, { column_id: column });
  expect(moved.status).toBe(200);
  return moved.body.data.task.version;
}

async function createWorkspace(owner: Persona): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/workspaces', { name: 'Access Team' });
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

async function assignee(owner: Persona, taskId: string): Promise<string | null> {
  return ((await callApi(owner, 'GET', `/api/tasks/${taskId}`)).body.data.task.assignee?.id as string | undefined) ?? null;
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

describe('task versions', () => {
  beforeEach(() => resetSecurityState());

  it('takes major and minor from the task’s own batch and the patch from that batch’s counter', async () => {
    const owner = await signUp('Version Owner');
    const projectId = await createProject(owner);
    const first = await createBatch(owner, projectId, { activate: true });
    // Opening a later batch must not move the versions of the active one.
    const second = await createBatch(owner, projectId);

    const inFirst = await createTask(owner, projectId);
    expect(inFirst).toMatchObject({ batch_id: first, version: { major: 0, minor: 1, patch: 1 } });
    const inSecond = await createTask(owner, projectId, { batch_id: second });
    expect(inSecond.version).toEqual({ major: 0, minor: 2, patch: 1 });
    expect(await move(owner, inFirst.id, 'ongoing')).toEqual({ major: 0, minor: 1, patch: 2 });

    const major = await createBatch(owner, projectId, { bump_major: true, activate: true });
    const inMajor = await createTask(owner, projectId);
    expect(inMajor).toMatchObject({ batch_id: major, version: { major: 1, minor: 0, patch: 1 } });
    // A task of an older batch keeps that batch's version line.
    expect(await move(owner, inFirst.id, 'review')).toEqual({ major: 0, minor: 1, patch: 3 });

    // Activating an older batch again continues its own patch counter.
    expect((await callApi(owner, 'PATCH', `/api/projects/${projectId}/batches/${first}/activate`)).status).toBe(200);
    expect((await createTask(owner, projectId)).version).toEqual({ major: 0, minor: 1, patch: 4 });
    expect(await move(owner, inSecond.id, 'ongoing')).toEqual({ major: 0, minor: 2, patch: 2 });

    const logs = (await callApi(owner, 'GET', `/api/tasks/${inFirst.id}/logs`)).body.data.logs as Array<{ version: string }>;
    expect(logs.map((log) => log.version)).toEqual(['v0.1.1', 'v0.1.2', 'v0.1.3']);
  });

  it('versions tasks outside any batch as v0.0.x', async () => {
    const owner = await signUp('Unbatched Owner');
    const projectId = await createProject(owner);
    const task = await createTask(owner, projectId);
    expect(task).toMatchObject({ batch_id: null, version: { major: 0, minor: 0, patch: 1 } });
    expect(await move(owner, task.id, 'ongoing')).toEqual({ major: 0, minor: 0, patch: 2 });
  });

  it('never gives two changes in one batch the same version, even when they arrive together', async () => {
    const owner = await signUp('Concurrent Owner');
    const projectId = await createProject(owner);
    await createBatch(owner, projectId, { activate: true });
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, index) => createTask(owner, projectId, { title: `Task ${index}` })));
    const patches = tasks.map((task) => task.version.patch).sort((left, right) => left - right);
    expect(patches).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });
});

describe('losing project access', () => {
  beforeEach(() => resetSecurityState());

  it('unassigns the tasks of a removed member who can no longer open the project, and tells the board', async () => {
    const owner = await signUp('Unassign Owner');
    const member = await signUp('Removed Member');
    const teammate = await signUp('Workspace Teammate Member');
    const workspaceId = await createWorkspace(owner);
    await joinWorkspace(owner, workspaceId, teammate);
    const projectId = await createProject(owner, { workspace_id: workspaceId });
    const otherProject = await createProject(owner, { name: 'Elsewhere' });
    for (const persona of [member, teammate]) {
      expect((await callApi(owner, 'POST', `/api/projects/${projectId}/members`, { email: persona.email })).status).toBe(201);
    }
    expect((await callApi(owner, 'POST', `/api/projects/${otherProject}/members`, { email: member.email })).status).toBe(201);
    const memberTask = await createTask(owner, projectId, { assignee_id: member.id });
    const keptElsewhere = await createTask(owner, otherProject, { assignee_id: member.id });
    const teammateTask = await createTask(owner, projectId, { assignee_id: teammate.id });
    const events = await listen(owner);

    expect((await callApi(owner, 'DELETE', `/api/projects/${projectId}/members/${member.id}`)).status).toBe(200);
    expect(await assignee(owner, memberTask.id)).toBeNull();
    expect(await assignee(owner, keptElsewhere.id)).toBe(member.id);
    expect(await drain(events)).toEqual(expect.arrayContaining([PROJECTS_CHANGED_EVENT, PROJECTS_BOARD_CHANGED_EVENT]));

    // Still a workspace member, so still able to open the project: the assignment stays.
    expect((await callApi(owner, 'DELETE', `/api/projects/${projectId}/members/${teammate.id}`)).status).toBe(200);
    expect(await assignee(owner, teammateTask.id)).toBe(teammate.id);
  });

  it('tells accounts that leave or are removed from a workspace that its projects changed, and unassigns them', async () => {
    const owner = await signUp('Leaving Owner');
    const leaver = await signUp('Workspace Leaver');
    const removed = await signUp('Workspace Removed');
    const workspaceId = await createWorkspace(owner);
    await joinWorkspace(owner, workspaceId, leaver);
    await joinWorkspace(owner, workspaceId, removed);
    const projectId = await createProject(owner, { workspace_id: workspaceId });
    const leaverTask = await createTask(owner, projectId, { assignee_id: leaver.id });
    const removedTask = await createTask(owner, projectId, { assignee_id: removed.id });
    const leaverEvents = await listen(leaver);
    const removedEvents = await listen(removed);
    const ownerEvents = await listen(owner);

    expect((await callApi(leaver, 'DELETE', `/api/workspaces/${workspaceId}/members/${leaver.id}`)).status).toBe(200);
    expect(await drain(leaverEvents)).toContain(PROJECTS_CHANGED_EVENT);
    expect(await assignee(owner, leaverTask.id)).toBeNull();
    expect(await drain(ownerEvents)).toContain(PROJECTS_BOARD_CHANGED_EVENT);

    expect((await callApi(owner, 'DELETE', `/api/workspaces/${workspaceId}/members/${removed.id}`)).status).toBe(200);
    expect(await drain(removedEvents)).toContain(PROJECTS_CHANGED_EVENT);
    expect(await assignee(owner, removedTask.id)).toBeNull();
    expect((await callApi(removed, 'GET', `/api/projects/${projectId}`)).status).toBe(403);
  });

  it('tells the members of a deleted workspace that its projects changed, and unassigns those who lost them', async () => {
    const owner = await signUp('Deleting Workspace Owner');
    const teammate = await signUp('Stranded Teammate');
    const direct = await signUp('Direct Project Member');
    const workspaceId = await createWorkspace(owner);
    await joinWorkspace(owner, workspaceId, teammate);
    await joinWorkspace(owner, workspaceId, direct);
    const projectId = await createProject(owner, { workspace_id: workspaceId });
    expect((await callApi(owner, 'POST', `/api/projects/${projectId}/members`, { email: direct.email })).status).toBe(201);
    const teammateTask = await createTask(owner, projectId, { assignee_id: teammate.id });
    const directTask = await createTask(owner, projectId, { assignee_id: direct.id });
    const teammateEvents = await listen(teammate);

    expect((await callApi(owner, 'DELETE', `/api/workspaces/${workspaceId}`)).status).toBe(200);
    expect(await drain(teammateEvents)).toContain(PROJECTS_CHANGED_EVENT);
    expect(await assignee(owner, teammateTask.id)).toBeNull();
    // A direct member keeps the project, and the assignment.
    expect(await assignee(owner, directTask.id)).toBe(direct.id);
  });
});
