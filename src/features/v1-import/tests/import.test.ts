import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi } from '../../../app/tests/api';
import { signIn, type Persona } from '../../../app/tests/personas';
import { getDatabase } from '../../../shared/database';
import { createLocalAssetStorage } from '../../../shared/storage';
import { findAccountByEmail, getUserRoles, hashPassword } from '../../auth';
import { importV1, V1_MIGRATIONS, V1ImportRefused } from '..';
import { V1_SCHEMA } from './v1-schema';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-05-01T00:00:00Z');
const WEBP = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 fixture', 'latin1');

const ids = {
  ram: randomUUID(),
  google: randomUUID(),
  plain: randomUUID(),
  moderator: randomUUID(),
  adminRole: randomUUID(),
  userRole: randomUUID(),
  moderatorRole: randomUUID(),
  workspace: randomUUID(),
  project: randomUUID(),
  fallbackProject: randomUUID(),
  batch01: randomUUID(),
  batch02: randomUUID(),
  batch03: randomUUID(),
  batch10: randomUUID(),
  batch11: randomUUID(),
  task1: randomUUID(),
  task2: randomUUID(),
  task3: randomUUID(),
  storedAttachment: randomUUID(),
  lostAttachment: randomUUID(),
  avatarAsset: randomUUID(),
  avatarFile: `${randomUUID()}.webp`,
  notification: randomUUID(),
};
const emails = {
  ram: `ram-${randomUUID()}@example.com`,
  google: `google-${randomUUID()}@example.com`,
  plain: `plain-${randomUUID()}@example.com`,
  moderator: `moderator-${randomUUID()}@example.com`,
};
const RAM_PASSWORD = 'ram v1 password';
const PLAIN_PASSWORD = 'plain v1 password';

interface Fixture {
  directory: string;
  file: string;
  storageDir: string;
  /** V1's own connection, left open so the latest rows sit only in the WAL. */
  v1: Database.Database;
}

/** A V1 database built from V1's schema, with its storage directory. */
async function createFixture(): Promise<Fixture> {
  const directory = mkdtempSync(path.join(tmpdir(), 'macroma-v1-fixture-'));
  const storageDir = path.join(directory, 'storage');
  mkdirSync(path.join(storageDir, 'avatars'), { recursive: true });
  mkdirSync(path.join(storageDir, 'task-attachments'), { recursive: true });
  writeFileSync(path.join(storageDir, 'avatars', ids.avatarFile), WEBP);
  writeFileSync(path.join(storageDir, 'task-attachments', `${ids.storedAttachment}.webp`), WEBP);

  const file = path.join(directory, 'dev.sqlite3');
  const v1 = new Database(file);
  v1.pragma('journal_mode = WAL');
  v1.pragma('wal_autocheckpoint = 0');
  v1.exec(V1_SCHEMA);
  const insert = (table: string, row: Record<string, unknown>) =>
    v1.prepare(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map((key) => `@${key}`).join(', ')})`).run(row);

  V1_MIGRATIONS.forEach((name, index) => insert('knex_migrations', { name, batch: index + 1, migration_time: '2026-04-01 00:00:00' }));

  const user = async (id: string, row: Record<string, unknown>) =>
    insert('users', { id, is_verified: 1, created_at: T0 - 30 * DAY, updated_at: T0 - 20 * DAY, ...row });
  await user(ids.ram, {
    name: 'Ram',
    email: emails.ram,
    phone: '+620001',
    avatar: `/storage/avatars/${ids.avatarFile}`,
    password: await hashPassword(RAM_PASSWORD),
  });
  // V1 gave Google accounts their own email as password.
  await user(ids.google, { name: 'Google', email: emails.google, password: await hashPassword(emails.google) });
  await user(ids.plain, {
    name: null,
    email: emails.plain,
    phone: '+620003',
    avatar: 'https://avatars.githubusercontent.com/u/1',
    is_verified: 0,
    password: await hashPassword(PLAIN_PASSWORD),
  });
  await user(ids.moderator, { name: 'Moderator', email: emails.moderator, password: await hashPassword('moderator password') });
  insert('assets', {
    id: ids.avatarAsset,
    name: ids.avatarFile,
    type: 'image',
    url: `/storage/avatars/${ids.avatarFile}`,
    mime_type: 'image/webp',
    size: WEBP.length,
    user_id: ids.ram,
    created_at: '2026-04-10 08:00:00',
    updated_at: '2026-04-10 08:00:00',
  });
  insert('assets', { id: randomUUID(), name: 'old.webp', type: 'image', url: '/storage/avatars/old.webp', user_id: ids.ram });

  const permission = (slug: string) => {
    const id = randomUUID();
    const [resource, action] = slug.split('.');
    insert('permissions', { id, name: slug, slug, resource, action, created_at: T0, updated_at: T0 });
    return id;
  };
  const usersView = permission('users.view');
  const settingsView = permission('settings.view');
  insert('roles', { id: ids.adminRole, name: 'Administrator', slug: 'admin', created_at: T0, updated_at: T0 });
  insert('roles', { id: ids.userRole, name: 'User', slug: 'user', created_at: T0, updated_at: T0 });
  insert('roles', { id: ids.moderatorRole, name: 'Moderator', slug: 'moderator', description: 'Moderates', created_at: T0, updated_at: T0 });
  insert('role_permissions', { id: randomUUID(), role_id: ids.moderatorRole, permission_id: usersView, created_at: T0 });
  insert('role_permissions', { id: randomUUID(), role_id: ids.moderatorRole, permission_id: settingsView, created_at: T0 });
  insert('role_permissions', { id: randomUUID(), role_id: ids.userRole, permission_id: settingsView, created_at: T0 });
  for (const [userId, roleId] of [
    [ids.ram, ids.adminRole],
    [ids.google, ids.userRole],
    [ids.plain, ids.userRole],
    [ids.moderator, ids.moderatorRole],
  ]) {
    insert('user_roles', { id: randomUUID(), user_id: userId, role_id: roleId, created_at: T0 });
  }
  insert('sessions', { id: randomUUID(), user_id: ids.ram, user_agent: 'V1', expires_at: T0 + DAY, created_at: T0 });
  insert('password_reset_tokens', { email: emails.plain, token: 'v1-token', expires_at: '2026-05-02 00:00:00' });

  insert('workspaces', { id: ids.workspace, name: 'Team', description: 'V1 team', owner_id: ids.ram, created_at: T0, updated_at: T0 });
  insert('workspace_members', { id: randomUUID(), workspace_id: ids.workspace, user_id: ids.ram, role: 'owner', created_at: T0 });
  insert('workspace_members', { id: randomUUID(), workspace_id: ids.workspace, user_id: ids.plain, role: 'member', created_at: T0 + HOUR });
  const invitation = (status: string, email: string) =>
    insert('workspace_invitations', {
      id: randomUUID(),
      workspace_id: ids.workspace,
      inviter_id: ids.ram,
      invitee_email: email,
      token: randomUUID().replaceAll('-', ''),
      status,
      expires_at: T0 + 7 * DAY,
      created_at: T0,
      updated_at: T0 + HOUR,
    });
  invitation('accepted', emails.plain);
  invitation('cancelled', 'someone@example.com');
  insert('workspace_messages', { id: randomUUID(), workspace_id: ids.workspace, user_id: ids.ram, message: 'Halo', created_at: T0 + HOUR, updated_at: T0 + HOUR });
  insert('notifications', {
    id: ids.notification,
    user_id: ids.ram,
    type: 'invitation_accepted',
    data: JSON.stringify({ workspace_id: ids.workspace, workspace_name: 'Team', accepter_name: 'Plain' }),
    is_read: 1,
    created_at: T0 + 2 * HOUR,
  });

  // Tami's scenario: 0.1 active, 0.2 created and activated, then 0.1 activated again; 0.3 only planned.
  insert('projects', {
    id: ids.project,
    name: 'Macroma',
    description: 'V1 project',
    owner_id: ids.ram,
    workspace_id: ids.workspace,
    created_at: T0,
    updated_at: T0,
  });
  insert('project_members', { id: randomUUID(), project_id: ids.project, user_id: ids.ram, role: 'owner', created_at: T0 });
  insert('project_members', { id: randomUUID(), project_id: ids.project, user_id: ids.plain, role: 'member', created_at: T0 });
  const batch = (id: string, projectId: string, minor: number, major: number, createdAt: number, active: boolean) =>
    insert('project_batches', { id, project_id: projectId, major, minor, label: `Batch ${major}.${minor}`, is_active: active ? 1 : 0, created_at: createdAt, updated_at: createdAt });
  batch(ids.batch01, ids.project, 1, 0, T0 + HOUR, true);
  batch(ids.batch02, ids.project, 2, 0, T0 + DAY, false);
  batch(ids.batch03, ids.project, 3, 0, T0 + 6 * DAY, false);
  const activity = (eventType: string, at: number, extra: Record<string, unknown> = {}) =>
    insert('project_activity_logs', {
      id: randomUUID(),
      project_id: ids.project,
      event_type: eventType,
      description: eventType,
      actor_id: ids.ram,
      created_at: at,
      ...extra,
    });
  activity('project.created', T0);
  activity('batch.activated', T0 + 2 * HOUR, { batch_id: ids.batch01 });
  activity('batch.activated', T0 + 2 * DAY, { batch_id: ids.batch02 });
  activity('batch.activated', T0 + 5 * DAY, { batch_id: ids.batch01 });

  const task = (id: string, row: Record<string, unknown>) =>
    insert('tasks', {
      id,
      project_id: ids.project,
      description: null,
      priority: 'medium',
      assignee_id: null,
      sort_order: 0,
      created_at: T0 + DAY,
      updated_at: T0 + 3 * DAY,
      ...row,
    });
  task(ids.task1, { batch_id: ids.batch01, title: 'In 0.1', column_id: 'ongoing', assignee_id: ids.plain, priority: 'high', version_major: 0, version_minor: 1, version_patch: 3 });
  task(ids.task2, { batch_id: ids.batch02, title: 'Shipped in 0.2', column_id: 'done', version_major: 0, version_minor: 2, version_patch: 2 });
  task(ids.task3, { batch_id: null, title: 'Outside batches', column_id: 'backlog', priority: 'urgent', version_major: 0, version_minor: 0, version_patch: 4 });
  activity('task.moved', T0 + 3 * DAY, { task_id: ids.task2, meta: JSON.stringify({ from: 'review', to: 'done', note: '', version: 'v0.2.2' }) });
  const log = (taskId: string, version: string, from: string | null, to: string, at: number) =>
    insert('task_logs', { id: randomUUID(), task_id: taskId, version, column_from: from, column_to: to, note: 'Tugas dibuat', created_by: ids.ram, created_at: at });
  log(ids.task1, 'v0.1.1', null, 'backlog', T0 + DAY);
  log(ids.task1, 'v0.1.3', 'backlog', 'ongoing', T0 + 2 * DAY);
  log(ids.task2, 'v0.2.1', null, 'review', T0 + DAY);
  log(ids.task2, 'v0.2.2', 'review', 'done', T0 + 3 * DAY);
  log(ids.task3, 'v0.0.4', null, 'backlog', T0 + DAY);
  insert('task_comments', { id: randomUUID(), task_id: ids.task1, user_id: ids.plain, content: 'Sudah dicek', created_at: T0 + 2 * DAY, updated_at: T0 + 2 * DAY });
  insert('task_attachments', {
    id: ids.storedAttachment,
    task_id: ids.task1,
    url: `/storage/task-attachments/${ids.storedAttachment}.webp`,
    name: 'screen.png',
    mime_type: 'image/webp',
    size: 999,
    uploaded_by: ids.plain,
    created_at: T0 + 2 * DAY,
    updated_at: T0 + 2 * DAY,
  });
  insert('task_attachments', {
    id: ids.lostAttachment,
    task_id: ids.task1,
    url: `/storage/task-attachments/${ids.lostAttachment}.webp`,
    name: 'lost.png',
    created_at: T0 + 2 * DAY,
    updated_at: T0 + 2 * DAY,
  });

  // A project without activation logs: the active batch and the ones before it count as activated at creation.
  insert('projects', { id: ids.fallbackProject, name: 'Old', owner_id: ids.ram, created_at: T0, updated_at: T0 });
  insert('project_members', { id: randomUUID(), project_id: ids.fallbackProject, user_id: ids.ram, role: 'owner', created_at: T0 });
  batch(ids.batch10, ids.fallbackProject, 0, 1, T0 + DAY, true);
  batch(ids.batch11, ids.fallbackProject, 1, 1, T0 + 3 * DAY, false);

  return { directory, file, storageDir, v1 };
}

describe('V1 import', () => {
  let fixture: Fixture;
  let target: string;
  let ram: Persona;

  beforeAll(async () => {
    fixture = await createFixture();
    target = mkdtempSync(path.join(tmpdir(), 'macroma-v1-target-'));
  });

  afterAll(() => {
    fixture.v1.close();
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });

  const storage = () => createLocalAssetStorage({ root: target });

  it('refuses a database that is not a V1 database, without writing', async () => {
    const other = path.join(fixture.directory, 'other.sqlite3');
    const database = new Database(other);
    database.exec("CREATE TABLE knex_migrations (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO knex_migrations (name) VALUES ('20990101000000_future.ts')");
    database.close();

    const refusal = await importV1({ from: other }, storage()).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(V1ImportRefused);
    expect((refusal as V1ImportRefused).reasons).toEqual([
      expect.stringContaining('lacks V1 migrations: 20230513055909_users.ts'),
      'the source has migrations this import does not know: 20990101000000_future.ts',
    ]);
    await expect(importV1({ from: path.join(fixture.directory, 'absent.sqlite3') }, storage())).rejects.toThrow(/no V1 database/);
    await expect(importV1({ from: fixture.file, storageDir: path.join(fixture.directory, 'absent') }, storage())).rejects.toThrow(
      /no V1 storage directory/,
    );
  });

  it('rehearses the whole import in a dry run, then rolls it back and stores nothing', async () => {
    const report = await importV1({ from: fixture.file, storageDir: fixture.storageDir, dryRun: true }, storage());

    expect(report.dryRun).toBe(true);
    expect(report.counts).toEqual({
      users: 4,
      // The target has no admin role yet (no reference seed), so V1's is created along with moderator.
      roles: 2,
      user_roles: 2,
      assets: 1,
      workspaces: 1,
      workspace_members: 2,
      workspace_invitations: 1,
      workspace_messages: 1,
      notifications: 1,
      projects: 2,
      project_members: 3,
      project_batches: 5,
      tasks: 3,
      task_logs: 5,
      project_activity_logs: 5,
      task_comments: 1,
      task_attachments: 1,
      files: 2,
    });
    expect(report.skipped).toEqual({ sessions: 1, password_reset_tokens: 1 });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        'role moderator: left out permissions V2 does not have: settings.view',
        `account ${emails.plain}: had no name, so it is named by its email`,
        '1 Google account(s) had their email as V1 password and got an unusable one; they sign in with Google or reset their password',
        '1 V1 asset(s) that are no account\'s current avatar were left out',
        '1 workspace invitation(s) with a status other than pending, accepted or declined were left out',
        `task ${ids.task3}: unknown priority urgent became medium`,
        `task attachment ${ids.lostAttachment} (/storage/task-attachments/${ids.lostAttachment}.webp) was left out: its file is missing`,
      ]),
    );
    expect(report.warnings).toHaveLength(7);

    expect(findAccountByEmail(emails.ram)).toBeUndefined();
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 });
    expect(await storage().get(`task-attachments/${ids.storedAttachment}.webp`)).toBeUndefined();
  });

  it('imports every V1 table into the owning features, from a copy that includes the WAL', async () => {
    const before = statSync(fixture.file);
    const report = await importV1({ from: fixture.file, storageDir: fixture.storageDir }, storage());
    expect(report.dryRun).toBe(false);
    expect(report.counts.users).toBe(4);
    // The V1 file was only copied: never written to, never checkpointed.
    expect(statSync(fixture.file).mtimeMs).toBe(before.mtimeMs);
    expect(statSync(fixture.file).size).toBe(before.size);

    // Accounts keep ids, passwords, phone, verified flag and roles; Google ones lose the email password.
    expect(findAccountByEmail(emails.ram)).toMatchObject({ id: ids.ram, name: 'Ram', phone: '+620001', verified: true });
    expect(findAccountByEmail(emails.plain)).toMatchObject({
      id: ids.plain,
      name: emails.plain,
      avatar: 'https://avatars.githubusercontent.com/u/1',
      verified: false,
    });
    expect(getUserRoles(ids.ram).map((role) => role.slug)).toEqual(['admin']);
    expect(getUserRoles(ids.plain)).toEqual([]);
    expect(getUserRoles(ids.moderator).map((role) => role.slug)).toEqual(['moderator']);
    const moderatorGrants = getDatabase()
      .prepare('SELECT p.slug FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?')
      .all(ids.moderatorRole);
    expect(moderatorGrants).toEqual([{ slug: 'users.view' }]);
    await expect(signIn(emails.google, emails.google)).rejects.toThrow(/Sign-in failed/);
    ram = { id: ids.ram, name: 'Ram', email: emails.ram, cookie: await signIn(emails.ram, RAM_PASSWORD) };

    // The avatar file is stored where Users serves it, under the V1 asset's id.
    const me = await callApi(ram, 'GET', '/api/auth/me');
    expect(me.body.data.user.avatar).toBe(`/api/assets/avatar/${ids.avatarFile}`);
    expect(getDatabase().prepare('SELECT id, storage_key, created_at FROM assets WHERE user_id = ?').all(ids.ram)).toEqual([
      { id: ids.avatarAsset, storage_key: `avatars/${ids.avatarFile}`, created_at: Date.parse('2026-04-10T08:00:00Z') },
    ]);
    expect(Buffer.from((await storage().get(`avatars/${ids.avatarFile}`))!.data)).toEqual(WEBP);

    const workspace = await callApi(ram, 'GET', `/api/workspaces/${ids.workspace}`);
    expect(workspace.status).toBe(200);
    const notifications = await callApi(ram, 'GET', '/api/notifications');
    expect(notifications.body.data.notifications).toEqual([
      expect.objectContaining({ id: ids.notification, type: 'invitation_accepted', is_read: true, created_at: T0 + 2 * HOUR }),
    ]);

    // Tami's scenario: 0.2 was released and closed when 0.1 was activated again.
    const releases = (await callApi(ram, 'GET', `/api/projects/${ids.project}/releases`)).body.data;
    expect(releases.active).toMatchObject({ id: ids.batch01, opened_at: T0 + 5 * DAY });
    expect(releases.closed).toEqual([expect.objectContaining({ id: ids.batch02, opened_at: T0 + 2 * DAY, closed_at: T0 + 5 * DAY })]);
    expect(releases.upcoming.map((batch: { id: string }) => batch.id)).toEqual([ids.batch03]);
    const fallback = (await callApi(ram, 'GET', `/api/projects/${ids.fallbackProject}/releases`)).body.data;
    expect(fallback.active).toMatchObject({ id: ids.batch10, opened_at: T0 + DAY });
    expect(fallback.closed).toEqual([]);
    expect(fallback.upcoming.map((batch: { id: string }) => batch.id)).toEqual([ids.batch11]);

    // Versions carry on after the imported ones.
    const next = await callApi(ram, 'POST', `/api/projects/${ids.project}/tasks`, { title: 'After import', batch_id: ids.batch01 });
    expect(next.body.data.task).toMatchObject({ version: { major: 0, minor: 1, patch: 4 } });
    expect(getDatabase().prepare('SELECT patch_counter FROM project_version_counters WHERE project_id = ?').get(ids.project)).toEqual({
      patch_counter: 4,
    });

    const detail = (await callApi(ram, 'GET', `/api/tasks/${ids.task1}`)).body.data.task;
    expect(detail).toMatchObject({ title: 'In 0.1', column_id: 'ongoing', comment_count: 1, attachment_count: 1 });
    const attachments = (await callApi(ram, 'GET', `/api/tasks/${ids.task1}/attachments`)).body.data.attachments;
    expect(attachments).toEqual([expect.objectContaining({ id: ids.storedAttachment, name: 'screen.png', size: WEBP.length })]);
    expect(Buffer.from((await storage().get(`task-attachments/${ids.storedAttachment}.webp`))!.data)).toEqual(WEBP);
    const task3 = (await callApi(ram, 'GET', `/api/tasks/${ids.task3}`)).body.data.task;
    expect(task3).toMatchObject({ priority: 'medium', version: { major: 0, minor: 0, patch: 4 } });
  });

  it('refuses to import into a database that already holds Macroma data or the V1 emails', async () => {
    const refusal = (await importV1({ from: fixture.file, dryRun: true }, storage()).catch((error: unknown) => error)) as V1ImportRefused;
    expect(refusal).toBeInstanceOf(V1ImportRefused);
    expect(refusal.reasons[0]).toMatch(/^the target already has Macroma rows: workspaces \(\d+\), projects \(\d+\), notifications \(\d+\)$/);
    expect(refusal.reasons[1]).toBe(
      `these V1 emails already have an account in the target: ${[emails.google, emails.moderator, emails.plain, emails.ram].sort().join(', ')}`,
    );
  });
});
