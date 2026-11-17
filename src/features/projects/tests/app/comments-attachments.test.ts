import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { grantAdmin, signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { csrfHeaders, issueCsrf } from '../../../../shared/security/tests/helpers';
import { TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES, TASK_ATTACHMENT_MAX_FILES, TASK_COMMENT_MAX_LENGTH } from '../../contract';

async function createProject(owner: Persona): Promise<string> {
  const created = await callApi(owner, 'POST', '/api/projects', { name: 'Gallery' });
  expect(created.status).toBe(201);
  return created.body.data.project.id;
}

async function addMember(owner: Persona, projectId: string, member: Persona): Promise<void> {
  expect((await callApi(owner, 'POST', `/api/projects/${projectId}/members`, { email: member.email })).status).toBe(201);
}

async function createTask(persona: Persona, projectId: string): Promise<string> {
  const created = await callApi(persona, 'POST', `/api/projects/${projectId}/tasks`, { title: 'Hero image' });
  expect(created.status).toBe(201);
  return created.body.data.task.id;
}

async function png(width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .png()
    .toBuffer();
}

function file(data: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(data)], name, { type });
}

async function upload(persona: Persona | undefined, taskId: string, files: File[]) {
  const form = new FormData();
  for (const entry of files) form.append('files', entry, entry.name);
  const response = await app.request(`/api/task-attachments?task_id=${encodeURIComponent(taskId)}`, {
    method: 'POST',
    headers: csrfHeaders(await issueCsrf(app, persona?.cookie)),
    body: form,
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function fetchFile(persona: Persona, url: string): Promise<Response> {
  return app.request(url, { headers: { Cookie: persona.cookie } });
}

function storedPath(attachmentId: string): string {
  const { storage_key } = getDatabase().prepare('SELECT storage_key FROM task_attachments WHERE id = ?').get(attachmentId) as {
    storage_key: string;
  };
  return resolve(process.cwd(), 'storage', storage_key);
}

async function boardTask(persona: Persona, projectId: string, taskId: string) {
  const board = await callApi(persona, 'GET', `/api/projects/${projectId}/tasks`);
  return (board.body.data.tasks as Array<{ id: string; comment_count: number; attachment_count: number }>).find((task) => task.id === taskId)!;
}

describe('task comments', () => {
  beforeEach(() => resetSecurityState());

  it('lists, adds and deletes comments for accounts that can open the project', async () => {
    const owner = await signUp('Comment Owner');
    const member = await signUp('Comment Member');
    const other = await signUp('Comment Other');
    const outsider = await signUp('Comment Outsider');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, member);
    await addMember(owner, projectId, other);
    const taskId = await createTask(owner, projectId);
    const path = `/api/tasks/${taskId}/comments`;

    const first = await callApi(member, 'POST', path, { content: '  Looks good  ' });
    expect(first.status).toBe(201);
    expect(first.body.data.comment).toMatchObject({
      task_id: taskId,
      content: 'Looks good',
      user: { id: member.id, name: member.name, avatar: null },
    });
    const second = await callApi(owner, 'POST', path, { content: 'Ship it' });
    const third = await callApi(other, 'POST', path, { content: 'One more thing' });

    const listed = await callApi(other, 'GET', path);
    expect(listed.body.data.comments.map((comment: { content: string }) => comment.content)).toEqual(['Looks good', 'Ship it', 'One more thing']);
    expect((await boardTask(owner, projectId, taskId)).comment_count).toBe(3);
    expect((await callApi(owner, 'GET', `/api/tasks/${taskId}`)).body.data.task.comment_count).toBe(3);

    expect((await callApi(outsider, 'GET', path)).status).toBe(403);
    expect((await callApi(outsider, 'POST', path, { content: 'Let me in' })).status).toBe(403);
    expect(await callApi(member, 'GET', `/api/tasks/${randomUUID()}/comments`)).toMatchObject({ status: 404, body: { code: 'TASK_NOT_FOUND' } });
    expect((await callApi(member, 'POST', path, { content: '   ' })).status).toBe(422);
    expect((await callApi(member, 'POST', path, { content: 'x'.repeat(TASK_COMMENT_MAX_LENGTH + 1) })).status).toBe(422);
    expect((await callApi(member, 'POST', path, { content: 'x'.repeat(TASK_COMMENT_MAX_LENGTH) })).status).toBe(201);

    // The author or the project owner deletes; another member may not.
    expect((await callApi(member, 'DELETE', `${path}/${third.body.data.comment.id}`)).status).toBe(403);
    expect((await callApi(other, 'DELETE', `${path}/${third.body.data.comment.id}`)).status).toBe(200);
    expect((await callApi(owner, 'DELETE', `${path}/${first.body.data.comment.id}`)).status).toBe(200);
    expect((await callApi(owner, 'DELETE', `${path}/${first.body.data.comment.id}`))).toMatchObject({
      status: 404,
      body: { code: 'COMMENT_NOT_FOUND' },
    });
    const otherTask = await createTask(owner, projectId);
    expect(await callApi(owner, 'DELETE', `/api/tasks/${otherTask}/comments/${second.body.data.comment.id}`)).toMatchObject({
      status: 404,
      body: { code: 'COMMENT_NOT_FOUND' },
    });
    expect((await boardTask(owner, projectId, taskId)).comment_count).toBe(2);
  });

  it('keeps the comments of a deleted account without its name', async () => {
    const admin = await signUp('Comment Admin');
    grantAdmin(admin.id);
    const owner = await signUp('Comment Keeper');
    const member = await signUp('Comment Leaver');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, member);
    const taskId = await createTask(owner, projectId);
    await callApi(member, 'POST', `/api/tasks/${taskId}/comments`, { content: 'Bye' });

    expect((await callApi(admin, 'DELETE', '/api/users', { ids: [member.id] })).status).toBe(200);
    expect((await callApi(owner, 'GET', `/api/tasks/${taskId}/comments`)).body.data.comments).toEqual([
      expect.objectContaining({ content: 'Bye', user: null }),
    ]);
  });
});

describe('task attachments', () => {
  beforeEach(() => resetSecurityState());

  it('uploads images as WebP within 1600 pixels and serves them only to accounts that can open the project', async () => {
    const owner = await signUp('Image Owner');
    const outsider = await signUp('Image Outsider');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);

    const uploaded = await upload(owner, taskId, [file(await png(2400, 1200), 'wide.png', 'image/png'), file(await png(), 'small.png', 'image/png')]);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.errors).toEqual([]);
    const [wide, small] = uploaded.body.data.attachments as Array<{ id: string; url: string; name: string; mime_type: string; uploaded_by: unknown }>;
    expect(wide).toMatchObject({ name: 'wide.png', mime_type: 'image/webp', uploaded_by: { id: owner.id, name: owner.name, avatar: null } });
    expect(wide.url).toBe(`/api/tasks/${taskId}/attachments/${wide.id}/file`);

    const served = await fetchFile(owner, wide.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toContain('private');
    const metadata = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 1600, height: 800 });
    expect((await sharp(Buffer.from(await (await fetchFile(owner, small.url)).arrayBuffer())).metadata()).width).toBe(40);

    expect((await fetchFile(outsider, wide.url)).status).toBe(403);
    expect((await app.request(wide.url)).status).toBe(401);
    expect((await fetchFile(owner, `/api/tasks/${taskId}/attachments/${randomUUID()}/file`)).status).toBe(404);
    expect((await upload(outsider, taskId, [file(await png(), 'nope.png', 'image/png')])).status).toBe(403);
    expect(await upload(owner, randomUUID(), [file(await png(), 'lost.png', 'image/png')])).toMatchObject({
      status: 404,
      body: { code: 'TASK_NOT_FOUND' },
    });

    const listed = await callApi(owner, 'GET', `/api/tasks/${taskId}/attachments`);
    expect(listed.body.data.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([wide.id, small.id]);
    expect((await boardTask(owner, projectId, taskId)).attachment_count).toBe(2);
    expect((await callApi(outsider, 'GET', `/api/tasks/${taskId}/attachments`)).status).toBe(403);
  });

  it('uploads the usable files and names each one that failed', async () => {
    const owner = await signUp('Partial Owner');
    const projectId = await createProject(owner);
    const taskId = await createTask(owner, projectId);
    const image = await png();
    // A full-size file is over the default request budget, so this also proves the route's own budget.
    const oversized = Buffer.concat([image, Buffer.alloc(TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES)]);

    const uploaded = await upload(owner, taskId, [
      file(image, 'good.png', 'image/png'),
      file(Buffer.from('not an image'), 'fake.png', 'image/png'),
      file(Buffer.from('%PDF-1.4'), 'notes.pdf', 'application/pdf'),
      file(oversized, 'huge.png', 'image/png'),
    ]);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.attachments.map((attachment: { name: string }) => attachment.name)).toEqual(['good.png']);
    expect(uploaded.body.data.errors).toEqual([
      'fake.png: not a valid image',
      'notes.pdf: only JPEG, PNG, GIF or WebP images are accepted',
      'huge.png: larger than 5MB',
    ]);

    const many = await upload(
      owner,
      taskId,
      Array.from({ length: TASK_ATTACHMENT_MAX_FILES + 2 }, (_, index) => file(image, `shot-${index}.png`, 'image/png')),
    );
    expect(many.status).toBe(201);
    expect(many.body.data.attachments).toHaveLength(TASK_ATTACHMENT_MAX_FILES);
    expect(many.body.data.errors).toEqual(['shot-8.png: at most 8 files per upload', 'shot-9.png: at most 8 files per upload']);

    expect(await upload(owner, taskId, [file(Buffer.from('nope'), 'fake.gif', 'image/gif')])).toMatchObject({
      status: 422,
      body: { code: 'NO_FILES_PROCESSED', errors: { files: ['fake.gif: not a valid image'] } },
    });
    expect(await upload(owner, taskId, [])).toMatchObject({ status: 422, body: { code: 'NO_FILES_PROCESSED' } });
    const missingTask = await app.request('/api/task-attachments', {
      method: 'POST',
      headers: csrfHeaders(await issueCsrf(app, owner.cookie)),
      body: new FormData(),
    });
    expect(missingTask.status).toBe(422);
    expect((await upload(undefined, taskId, [file(image, 'anon.png', 'image/png')])).status).toBe(401);
  });

  it('lets the uploader or the project owner delete an image, and removes its file', async () => {
    const owner = await signUp('Deleting Image Owner');
    const member = await signUp('Image Uploader');
    const other = await signUp('Image Bystander');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, member);
    await addMember(owner, projectId, other);
    const taskId = await createTask(owner, projectId);
    const uploaded = await upload(member, taskId, [file(await png(), 'a.png', 'image/png'), file(await png(), 'b.png', 'image/png')]);
    const [first, second] = uploaded.body.data.attachments as Array<{ id: string; url: string }>;
    const firstPath = storedPath(first.id);
    const secondPath = storedPath(second.id);
    expect(existsSync(firstPath)).toBe(true);
    const path = (id: string) => `/api/tasks/${taskId}/attachments/${id}`;

    expect((await callApi(other, 'DELETE', path(first.id))).status).toBe(403);
    expect((await callApi(member, 'DELETE', path(first.id))).status).toBe(200);
    expect(existsSync(firstPath)).toBe(false);
    expect((await fetchFile(member, first.url)).status).toBe(404);
    expect((await callApi(owner, 'DELETE', path(second.id))).status).toBe(200);
    expect(existsSync(secondPath)).toBe(false);
    expect(await callApi(owner, 'DELETE', path(second.id))).toMatchObject({ status: 404, body: { code: 'ATTACHMENT_NOT_FOUND' } });

    const activity = (await callApi(owner, 'GET', `/api/projects/${projectId}/activity`)).body.data.activity as Array<{ event_type: string }>;
    expect(activity.map((entry) => entry.event_type).slice(0, 3)).toEqual(['task.attachment_removed', 'task.attachment_removed', 'task.attachment_added']);
  });

  it('removes the files of a deleted task, a deleted project and a deleted owner’s projects', async () => {
    const admin = await signUp('Files Admin');
    grantAdmin(admin.id);
    const owner = await signUp('Files Owner');
    const projectId = await createProject(owner);
    const firstTask = await createTask(owner, projectId);
    const secondTask = await createTask(owner, projectId);
    const taskImage = (await upload(owner, firstTask, [file(await png(), 'task.png', 'image/png')])).body.data.attachments[0].id;
    const projectImage = (await upload(owner, secondTask, [file(await png(), 'project.png', 'image/png')])).body.data.attachments[0].id;
    const taskPath = storedPath(taskImage);
    const projectPath = storedPath(projectImage);

    expect((await callApi(owner, 'DELETE', `/api/tasks/${firstTask}`)).status).toBe(200);
    expect(existsSync(taskPath)).toBe(false);
    expect(existsSync(projectPath)).toBe(true);
    expect((await callApi(owner, 'DELETE', `/api/projects/${projectId}`)).status).toBe(200);
    expect(existsSync(projectPath)).toBe(false);

    const ownedProject = await createProject(owner);
    const ownedTask = await createTask(owner, ownedProject);
    const ownedImage = (await upload(owner, ownedTask, [file(await png(), 'owned.png', 'image/png')])).body.data.attachments[0].id;
    const ownedPath = storedPath(ownedImage);
    expect((await callApi(admin, 'DELETE', '/api/users', { ids: [owner.id] })).status).toBe(200);
    await expect.poll(() => existsSync(ownedPath)).toBe(false);
  });
});
