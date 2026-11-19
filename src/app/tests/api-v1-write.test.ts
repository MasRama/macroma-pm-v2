import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NOTIFICATIONS_CHANGED_EVENT, notificationsResponseSchemas } from '../../features/notifications';
import { PROJECTS_BOARD_CHANGED_EVENT, PROJECTS_NOTIFICATION_TYPES, projectsResponseSchemas } from '../../features/projects';
import { closeEventStreams, EVENTS_PATH, STREAM_READY_EVENT } from '../../shared/realtime';
import { readEvents, type EventReader } from '../../shared/realtime/tests/helpers';
import { publicApiOperations, type PublicApiOperation } from '../openapi';
import { app, PUBLIC_API_PREFIX, resetSecurityState } from '../server';
import { callApi, type ApiAnswer } from './api';
import { issueApiToken, signUp, type Persona } from './personas';

/**
 * The public API's task writes through the composed application. Each write
 * is made once through the browser route with a session and once through
 * `/api/v1` with a token, on two boards built alike: the answers, the live
 * events each account receives, the project activity, the task's history
 * and the notifications must come out the same, with the token's account as
 * the actor.
 */
const operations = publicApiOperations();
const answered = new Set<PublicApiOperation>();
const apiError = projectsResponseSchemas().apiError;

function operationFor(method: string, path: string): PublicApiOperation {
  const operation = operations.find(
    (candidate) => candidate.method === method && new RegExp(`^${candidate.path.replace(/:[^/]+/g, '[^/]+')}$`).test(path),
  );
  if (!operation) throw new Error(`No documented operation for ${method.toUpperCase()} ${path}`);
  return operation;
}

/** Calls `/api/v1` with the token and parses the answer with the schema its operation documents. */
async function v1(token: string, method: string, path: string, body?: unknown): Promise<ApiAnswer> {
  const response = await app.request(`${PUBLIC_API_PREFIX}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const answer = { status: response.status, body: await response.json() };
  const operation = operationFor(method.toLowerCase(), path);
  const documented = operation.responses[answer.status];
  if (documented) {
    documented.parse(answer.body);
    answered.add(operation);
  } else if (answer.status === 409 && answer.body.code === 'STALE_REVISION') {
    operation.stale!.parse(answer.body);
  } else {
    apiError.parse(answer.body);
  }
  return answer;
}

type Role = 'owner' | 'member' | 'assignee' | 'outsider';
const ROLES: Role[] = ['owner', 'member', 'assignee', 'outsider'];

interface Board {
  people: Record<Role, Persona>;
  projectId: string;
  /** Created by the owner, assigned to the assignee. */
  taskId: string;
  /** Write tokens of the owner and the member. */
  token: Record<'owner' | 'member', string>;
}

/** A project of the owner with a member and an assignee, one task, and an outsider who cannot open it. */
async function board(): Promise<Board> {
  // Each board signs up four accounts and mints two tokens: more than the strict limit allows twice.
  resetSecurityState();
  const people = {
    owner: await signUp('Board Owner'),
    member: await signUp('Board Member'),
    assignee: await signUp('Task Assignee'),
    outsider: await signUp('Outsider'),
  };
  const project = await callApi(people.owner, 'POST', '/api/projects', { name: 'Apollo' });
  expect(project.status).toBe(201);
  const projectId = project.body.data.project.id as string;
  for (const role of ['member', 'assignee'] as const) {
    expect((await callApi(people.owner, 'POST', `/api/projects/${projectId}/members`, { email: people[role].email })).status).toBe(201);
  }
  const task = await callApi(people.owner, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Ship the API', assignee_id: people.assignee.id });
  expect(task.status).toBe(201);
  const token = { owner: await issueApiToken(people.owner, 'write'), member: await issueApiToken(people.member, 'write') };
  return { people, projectId, taskId: task.body.data.task.id, token };
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
  return seen.sort();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The observation with each board's own ids, emails and times taken out:
 * accounts become their role, other ids a number in order of appearance, and
 * timestamps are dropped.
 */
function comparable(value: unknown, board: Board): unknown {
  const labels = new Map<string, string>();
  for (const role of ROLES) {
    labels.set(board.people[role].id, role);
    labels.set(board.people[role].email, `${role}@`);
  }
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (labels.has(node)) return labels.get(node);
      if (UUID.test(node)) labels.set(node, `id#${labels.size}`);
      return labels.get(node) ?? node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => !key.endsWith('_at'))
          .map(([key, child]) => [key, walk(child)]),
      );
    }
    return node;
  };
  return walk(value);
}

interface Write {
  /** Who makes the write; the owner for owner-only writes. */
  as: 'owner' | 'member';
  method: 'POST' | 'PATCH' | 'DELETE';
  path: (board: Board) => string;
  body?: Record<string, unknown> | ((board: Board) => Record<string, unknown>);
}

/** Makes the write on a new board through one channel, and records everything it caused. */
async function observe(channel: 'ui' | 'v1', write: Write) {
  const current = await board();
  const streams = Object.fromEntries(await Promise.all(ROLES.map(async (role) => [role, await listen(current.people[role])] as const)));
  const path = write.path(current);
  const body = typeof write.body === 'function' ? write.body(current) : write.body;
  const answer =
    channel === 'ui'
      ? await callApi(current.people[write.as], write.method, `/api${path}`, body)
      : await v1(current.token[write.as], write.method, path, body);
  const events = Object.fromEntries(await Promise.all(ROLES.map(async (role) => [role, await drain(streams[role])] as const)));
  const owner = current.people.owner;
  const taskId = (answer.body.data?.task?.id as string | undefined) ?? current.taskId;
  const activity = await callApi(owner, 'GET', `/api/projects/${current.projectId}/activity`);
  const logs = await callApi(owner, 'GET', `/api/tasks/${taskId}/logs`);
  const comments = await callApi(owner, 'GET', `/api/tasks/${taskId}/comments`);
  const notices: Record<string, unknown> = {};
  for (const role of ROLES) {
    const listed = await callApi(current.people[role], 'GET', '/api/notifications');
    notices[role] = notificationsResponseSchemas().listSuccess.parse(listed.body).data.notifications;
  }
  return comparable({ answer, events, activity: activity.body, logs, comments, notices }, current) as {
    answer: ApiAnswer;
    events: Record<Role, string[]>;
    activity: { data: { activity: Array<{ event_type: string; actor: { id: string } | null }> } };
    logs: ApiAnswer;
    comments: ApiAnswer;
    notices: Record<Role, Array<{ type: string; data: Record<string, unknown> }>>;
  };
}

/** The same write through the browser route and the public API, which must leave the same trace. */
async function parity(write: Write) {
  const ui = await observe('ui', write);
  const api = await observe('v1', write);
  expect(api).toEqual(ui);
  return api;
}

describe('public API v1 writes', () => {
  afterEach(() => closeEventStreams());
  afterAll(() => resetSecurityState());

  it('creates a task as the browser does', async () => {
    const result = await parity({
      as: 'member',
      method: 'POST',
      path: (current) => `/projects/${current.projectId}/tasks`,
      body: (current) => ({ title: 'Write the changelog', priority: 'high', assignee_id: current.people.assignee.id }),
    });
    expect(result.answer).toMatchObject({ status: 201, body: { data: { task: { title: 'Write the changelog', column_id: 'backlog' } } } });
    expect(result.events).toEqual({
      owner: [PROJECTS_BOARD_CHANGED_EVENT],
      member: [PROJECTS_BOARD_CHANGED_EVENT],
      assignee: [PROJECTS_BOARD_CHANGED_EVENT],
      outsider: [],
    });
    expect(result.activity.data.activity[0]).toMatchObject({ event_type: 'task.created', actor: { id: 'member' } });
    expect(result.logs.body.data.logs).toMatchObject([{ user: { id: 'member' } }]);
  });

  it('edits a task as the browser does', async () => {
    const result = await parity({
      as: 'member',
      method: 'PATCH',
      path: (current) => `/tasks/${current.taskId}`,
      body: { revision: 1, title: 'Ship the public API', priority: 'low' },
    });
    expect(result.answer).toMatchObject({ status: 200, body: { data: { task: { title: 'Ship the public API', revision: 2 } } } });
    expect(result.events.member).toEqual([PROJECTS_BOARD_CHANGED_EVENT]);
    expect(result.events.outsider).toEqual([]);
    expect(result.activity.data.activity[0]).toMatchObject({ actor: { id: 'member' } });
  });

  it('moves a task as the browser does, notifying its assignee and creator', async () => {
    const result = await parity({
      as: 'member',
      method: 'PATCH',
      path: (current) => `/tasks/${current.taskId}/move`,
      body: { column_id: 'ongoing' },
    });
    expect(result.answer).toMatchObject({ status: 200, body: { data: { task: { column_id: 'ongoing' }, log: { column_to: 'ongoing' } } } });
    // The owner created the task; both it and the assignee are told, never the mover.
    expect(result.events).toEqual({
      owner: [NOTIFICATIONS_CHANGED_EVENT, PROJECTS_BOARD_CHANGED_EVENT].sort(),
      member: [PROJECTS_BOARD_CHANGED_EVENT],
      assignee: [NOTIFICATIONS_CHANGED_EVENT, PROJECTS_BOARD_CHANGED_EVENT].sort(),
      outsider: [],
    });
    for (const role of ['owner', 'assignee'] as const) {
      expect(result.notices[role]).toMatchObject([
        { type: PROJECTS_NOTIFICATION_TYPES.taskMoved, data: { actor_id: 'member', actor_name: 'Board Member', column_to: 'ongoing' } },
      ]);
    }
    expect(result.notices.member).toEqual([]);
    expect(result.logs.body.data.logs.at(-1)).toMatchObject({ column_to: 'ongoing', user: { id: 'member' } });
    expect(result.activity.data.activity[0]).toMatchObject({ actor: { id: 'member' } });
  });

  it('deletes a task as the browser does', async () => {
    const result = await parity({ as: 'owner', method: 'DELETE', path: (current) => `/tasks/${current.taskId}` });
    expect(result.answer).toMatchObject({ status: 200, body: { success: true, message: 'Task deleted' } });
    expect(result.logs.status).toBe(404);
    expect(result.events.member).toEqual([PROJECTS_BOARD_CHANGED_EVENT]);
    expect(result.events.outsider).toEqual([]);
    expect(result.activity.data.activity[0]).toMatchObject({ event_type: 'task.deleted', actor: { id: 'owner' } });
  });

  it('comments on a task as the browser does', async () => {
    const result = await parity({
      as: 'member',
      method: 'POST',
      path: (current) => `/tasks/${current.taskId}/comments`,
      body: { content: 'Looks good to me' },
    });
    expect(result.answer).toMatchObject({ status: 201, body: { data: { comment: { content: 'Looks good to me', user: { id: 'member' } } } } });
    expect(result.comments.body.data.comments).toHaveLength(1);
    expect(result.events.assignee).toEqual([PROJECTS_BOARD_CHANGED_EVENT]);
    expect(result.events.outsider).toEqual([]);
  });

  it('refuses every write to a read token, changing nothing', async () => {
    const current = await board();
    const read = await issueApiToken(current.people.owner, 'read');
    const writes: Array<[string, string, Record<string, unknown>?]> = [
      ['POST', `/projects/${current.projectId}/tasks`, { title: 'Nope' }],
      ['PATCH', `/tasks/${current.taskId}`, { revision: 1, title: 'Nope' }],
      ['PATCH', `/tasks/${current.taskId}/move`, { column_id: 'done' }],
      ['DELETE', `/tasks/${current.taskId}`],
      ['POST', `/tasks/${current.taskId}/comments`, { content: 'Nope' }],
    ];
    for (const [method, path, body] of writes) {
      expect(await v1(read, method, path, body), `${method} ${path}`).toMatchObject({
        status: 403,
        body: { code: 'TOKEN_SCOPE_INSUFFICIENT' },
      });
    }
    const task = await v1(read, 'GET', `/tasks/${current.taskId}`);
    expect(task.body.data.task).toMatchObject({ title: 'Ship the API', revision: 1, column_id: 'backlog' });
    expect((await v1(read, 'GET', `/projects/${current.projectId}/tasks`)).body.data.tasks).toHaveLength(1);
  });

  it('refuses an account that cannot open the project, and leaves deleting to the owner', async () => {
    const current = await board();
    const outsider = await issueApiToken(current.people.outsider, 'write');
    const writes: Array<[string, string, Record<string, unknown>?]> = [
      ['POST', `/projects/${current.projectId}/tasks`, { title: 'Nope' }],
      ['PATCH', `/tasks/${current.taskId}`, { revision: 1, title: 'Nope' }],
      ['PATCH', `/tasks/${current.taskId}/move`, { column_id: 'done' }],
      ['DELETE', `/tasks/${current.taskId}`],
      ['POST', `/tasks/${current.taskId}/comments`, { content: 'Nope' }],
    ];
    for (const [method, path, body] of writes) {
      expect(await v1(outsider, method, path, body), `${method} ${path}`).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    }
    expect(await v1(current.token.member, 'DELETE', `/tasks/${current.taskId}`)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(await v1(current.token.member, 'DELETE', `/tasks/${randomUUID()}`)).toMatchObject({ status: 404, body: { code: 'TASK_NOT_FOUND' } });
    expect(
      await v1(current.token.member, 'POST', `/projects/${randomUUID()}/tasks`, { title: 'Nowhere' }),
    ).toMatchObject({ status: 404, body: { code: 'PROJECT_NOT_FOUND' } });
  });

  it('refuses an assignee who cannot open the project, an unknown batch and a bad body', async () => {
    const current = await board();
    const assigneeRefused = { status: 422, body: { code: 'VALIDATION_ERROR', errors: { assignee_id: [expect.any(String)] } } };
    const outsiderId = current.people.outsider.id;
    expect(
      await v1(current.token.member, 'POST', `/projects/${current.projectId}/tasks`, { title: 'Hand off', assignee_id: outsiderId }),
    ).toMatchObject(assigneeRefused);
    expect(await v1(current.token.member, 'PATCH', `/tasks/${current.taskId}`, { revision: 1, assignee_id: outsiderId })).toMatchObject(
      assigneeRefused,
    );
    expect(
      await v1(current.token.member, 'POST', `/projects/${current.projectId}/tasks`, { title: 'Later', batch_id: randomUUID() }),
    ).toMatchObject({ status: 404, body: { code: 'BATCH_NOT_FOUND' } });
    expect(await v1(current.token.member, 'PATCH', `/tasks/${current.taskId}/move`, { column_id: 'revisi' })).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_ERROR', errors: { note: [expect.any(String)] } },
    });
    expect(await v1(current.token.member, 'POST', `/tasks/${current.taskId}/comments`, { content: '   ' })).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_ERROR' },
    });
  });

  it('answers a stale edit with the task as it is now, and a move to the same column with a conflict', async () => {
    const current = await board();
    const path = `/tasks/${current.taskId}`;
    expect((await v1(current.token.member, 'PATCH', path, { revision: 1, title: 'First edit' })).status).toBe(200);
    expect(await v1(current.token.owner, 'PATCH', path, { revision: 1, title: 'Second edit' })).toMatchObject({
      status: 409,
      body: { code: 'STALE_REVISION', current: { title: 'First edit', revision: 2 } },
    });
    expect(await v1(current.token.member, 'PATCH', `${path}/move`, { column_id: 'backlog' })).toMatchObject({
      status: 409,
      body: { code: 'TASK_ALREADY_IN_COLUMN' },
    });
  });

  it('takes no session cookie in place of a token, and needs no CSRF token with one', async () => {
    const current = await board();
    const withCookie = await app.request(`${PUBLIC_API_PREFIX}/tasks/${current.taskId}/comments`, {
      method: 'POST',
      headers: { Cookie: current.people.member.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'From the browser' }),
    });
    expect(withCookie.status).toBe(401);
    const withToken = await v1(current.token.member, 'POST', `/tasks/${current.taskId}/comments`, { content: 'From a script' });
    expect(withToken.status).toBe(201);
  });

  it('answered every documented write in its documented shape', () => {
    const writes = operations.filter((operation) => operation.method !== 'get');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.filter((operation) => !answered.has(operation)).map((operation) => `${operation.method} ${operation.path}`)).toEqual([]);
  });
});
