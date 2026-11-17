import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { discoverMigrations, getDatabase, outstandingMigrations } from '../../../shared/database';
import type { AssetStorage } from '../../../shared/storage';
import {
  comparePassword,
  createRoleWithPermissions,
  findAccountByEmail,
  findAllPermissions,
  findAllRoles,
  hashPassword,
  importAccounts,
  type ImportedAccount,
} from '../../auth';
import { countNotificationRows, importNotificationRows, type ImportedNotification } from '../../notifications';
import {
  countProjectRows,
  importProjectRows,
  PROJECT_ACTIVITY_EVENTS,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  taskAttachmentStorageKey,
  type ProjectImport,
} from '../../projects';
import { avatarLocation, importAvatarAssets, type ImportedAvatarAsset } from '../../users';
import { countWorkspaceRows, importWorkspaceRows, type WorkspaceImport } from '../../workspaces';
import { V1ImportRefused, type V1ImportOptions, type V1ImportReport } from '../contract';
import { openV1Copy, v1SchemaProblems } from './source';

type Row = Record<string, unknown>;
type TaskColumn = (typeof TASK_COLUMNS)[number];
type TaskPriority = (typeof TASK_PRIORITIES)[number];

const PBKDF2_HASH = /^[0-9a-f]+:[0-9a-f]{128}$/i;
/** The file names the avatar route serves. */
const AVATAR_FILENAME = /^[a-f0-9-]+\.webp$/i;
const INVITATION_STATUSES = new Set(['pending', 'accepted', 'declined']);
/** V1's `user` role is what V2 calls a plain account: no role at all. */
const V1_PLAIN_ROLE = 'user';

interface RoleToCreate {
  role: { id: string; name: string; slug: string; description: string | null };
  permissionIds: string[];
}

interface FileToStore {
  key: string;
  source: string;
  contentType: string;
}

interface ImportPlan {
  roles: RoleToCreate[];
  avatars: ImportedAvatarAsset[];
  accounts: ImportedAccount[];
  workspaces: WorkspaceImport;
  notifications: ImportedNotification[];
  projects: ProjectImport;
  files: FileToStore[];
  warnings: string[];
}

class DryRunRollback extends Error {}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function flag(value: unknown): boolean {
  return value === 1 || value === true || value === '1' || value === 'true';
}

/** A V1 time: epoch milliseconds, or a knex `datetime` string written in UTC. */
function time(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Where a V1 `/storage/<directory>/<file>` URL's file is under the V1 storage
 * directory: `undefined` for any other URL, `missing` when the file is not
 * there (or no storage directory was given).
 */
function storedFile(
  storageDir: string | undefined,
  url: string | null,
  directory: string,
): { status: 'found'; path: string; filename: string; size: number } | { status: 'missing' } | undefined {
  const prefix = `/storage/${directory}/`;
  if (!url?.startsWith(prefix)) return undefined;
  const filename = url.slice(prefix.length);
  if (!storageDir || filename === '' || filename.includes('/') || filename.includes('\\') || filename.startsWith('.')) return { status: 'missing' };
  const file = path.join(path.resolve(storageDir), directory, filename);
  if (!existsSync(file) || !statSync(file).isFile()) return { status: 'missing' };
  return { status: 'found', path: file, filename, size: statSync(file).size };
}

/** The value parsed as a JSON object, or `undefined` when it is not one. */
function jsonObject(value: unknown): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function all(v1: Database.Database, sql: string): Row[] {
  return v1.prepare(sql).all() as Row[];
}

function count(v1: Database.Database, table: string): number {
  return (v1.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

/** Everything that keeps the import from starting; nothing has been written. */
function targetProblems(v1: Database.Database): string[] {
  const pending = outstandingMigrations(getDatabase(), discoverMigrations());
  if (pending.length > 0) {
    return [`the target database has ${pending.length} pending migration(s); run npm run migrate first`];
  }
  const problems: string[] = [];
  const filled = (
    [
      ['workspaces', countWorkspaceRows()],
      ['projects', countProjectRows()],
      ['notifications', countNotificationRows()],
    ] as const
  ).filter(([, rows]) => rows > 0);
  if (filled.length > 0) {
    problems.push(`the target already has Macroma rows: ${filled.map(([name, rows]) => `${name} (${rows})`).join(', ')}`);
  }
  const taken = all(v1, 'SELECT email FROM users ORDER BY email')
    .map((row) => String(row.email))
    .filter((email) => findAccountByEmail(email) !== undefined);
  if (taken.length > 0) problems.push(`these V1 emails already have an account in the target: ${taken.join(', ')}`);
  return problems;
}

function planRoles(v1: Database.Database, warnings: string[]): { roles: RoleToCreate[]; roleIds: Map<string, string | null> } {
  const existing = new Map(findAllRoles().map((role) => [role.slug, role.id]));
  const permissions = new Map(findAllPermissions().map((permission) => [permission.slug, permission.id]));
  const grants = all(v1, 'SELECT rp.role_id, p.slug FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id ORDER BY p.slug');
  const roles: RoleToCreate[] = [];
  const roleIds = new Map<string, string | null>();
  for (const role of all(v1, 'SELECT id, name, slug, description FROM roles ORDER BY slug')) {
    const id = String(role.id);
    const slug = String(role.slug);
    if (slug === V1_PLAIN_ROLE) {
      roleIds.set(id, null);
      continue;
    }
    const match = existing.get(slug);
    if (match) {
      roleIds.set(id, match);
      continue;
    }
    const slugs = grants.filter((grant) => grant.role_id === id).map((grant) => String(grant.slug));
    const unknown = slugs.filter((permission) => !permissions.has(permission));
    if (unknown.length > 0) warnings.push(`role ${slug}: left out permissions V2 does not have: ${unknown.join(', ')}`);
    roles.push({
      role: { id, name: text(role.name) ?? slug, slug, description: text(role.description) },
      permissionIds: slugs.filter((permission) => permissions.has(permission)).map((permission) => permissions.get(permission)!),
    });
    roleIds.set(id, id);
  }
  return { roles, roleIds };
}

async function planAccounts(
  v1: Database.Database,
  storageDir: string | undefined,
  roleIds: Map<string, string | null>,
  files: FileToStore[],
  warnings: string[],
): Promise<{ accounts: ImportedAccount[]; avatars: ImportedAvatarAsset[] }> {
  const now = Date.now();
  const assets = new Map(all(v1, 'SELECT id, url, created_at, updated_at FROM assets').map((asset) => [String(asset.url), asset]));
  const assignments = all(v1, 'SELECT user_id, role_id FROM user_roles');
  const accounts: ImportedAccount[] = [];
  const avatars: ImportedAvatarAsset[] = [];
  const usedAssets = new Set<string>();
  let googleAccounts = 0;

  for (const user of all(v1, 'SELECT * FROM users ORDER BY created_at, id')) {
    const id = String(user.id);
    const email = String(user.email);
    const createdAt = time(user.created_at, now);
    const updatedAt = time(user.updated_at, createdAt);

    let passwordHash = String(user.password);
    if (!PBKDF2_HASH.test(passwordHash)) {
      warnings.push(`account ${email}: its V1 password is not a PBKDF2 hash, so it got an unusable one; it must reset its password`);
      passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    } else if (await comparePassword(email, passwordHash)) {
      // V1 gave Google accounts their own email as password: anyone knowing the email could sign in.
      googleAccounts += 1;
      passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    }

    let avatar = text(user.avatar);
    if (avatar && !/^https?:\/\//i.test(avatar)) {
      const file = storedFile(storageDir, avatar, 'avatars');
      if (file?.status === 'found' && AVATAR_FILENAME.test(file.filename)) {
        const asset = assets.get(avatar);
        const location = avatarLocation(file.filename);
        const assetId = asset ? String(asset.id) : randomUUID();
        avatars.push({
          id: assetId,
          userId: id,
          filename: file.filename,
          size: file.size,
          createdAt: time(asset?.created_at, updatedAt),
          updatedAt: time(asset?.updated_at, updatedAt),
        });
        usedAssets.add(avatar);
        files.push({ key: location.storageKey, source: file.path, contentType: 'image/webp' });
        avatar = location.url;
      } else {
        warnings.push(`account ${email}: avatar ${avatar} was left out, its file is ${file ? 'missing' : 'not a V1 avatar upload'}`);
        avatar = null;
      }
    }

    const name = text(user.name)?.trim();
    if (!name) warnings.push(`account ${email}: had no name, so it is named by its email`);
    accounts.push({
      id,
      name: name || email,
      email,
      passwordHash,
      avatar,
      phone: text(user.phone),
      verified: flag(user.is_verified),
      createdAt,
      updatedAt,
      roleIds: assignments
        .filter((assignment) => assignment.user_id === id)
        .map((assignment) => roleIds.get(String(assignment.role_id)))
        .filter((roleId): roleId is string => typeof roleId === 'string'),
    });
  }

  if (googleAccounts > 0) {
    warnings.push(
      `${googleAccounts} Google account(s) had their email as V1 password and got an unusable one; they sign in with Google or reset their password`,
    );
  }
  const unused = [...assets.keys()].filter((url) => !usedAssets.has(url)).length;
  if (unused > 0) warnings.push(`${unused} V1 asset(s) that are no account's current avatar were left out`);
  return { accounts, avatars };
}

function planWorkspaces(v1: Database.Database, warnings: string[]): WorkspaceImport {
  const invitations = all(v1, 'SELECT * FROM workspace_invitations ORDER BY created_at, id');
  const kept = invitations.filter((invitation) => INVITATION_STATUSES.has(String(invitation.status)));
  if (kept.length < invitations.length) {
    warnings.push(`${invitations.length - kept.length} workspace invitation(s) with a status other than pending, accepted or declined were left out`);
  }
  return {
    workspaces: all(v1, 'SELECT * FROM workspaces ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: text(row.description),
      owner_id: String(row.owner_id),
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    })),
    members: all(v1, 'SELECT * FROM workspace_members ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      user_id: String(row.user_id),
      role: row.role === 'owner' ? 'owner' : 'member',
      created_at: time(row.created_at, 0),
    })),
    invitations: kept.map((row) => ({
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      inviter_id: String(row.inviter_id),
      invitee_email: String(row.invitee_email),
      token: String(row.token),
      status: row.status as 'pending' | 'accepted' | 'declined',
      expires_at: time(row.expires_at, 0),
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    })),
    messages: all(v1, 'SELECT * FROM workspace_messages ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      user_id: String(row.user_id),
      message: String(row.message),
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    })),
  };
}

function planNotifications(v1: Database.Database, warnings: string[]): ImportedNotification[] {
  return all(v1, 'SELECT * FROM notifications ORDER BY created_at, id').map((row) => {
    const data: ImportedNotification['data'] = {};
    const parsed = jsonObject(row.data);
    if (parsed === undefined) warnings.push(`notification ${String(row.id)}: its data was not a JSON object and was emptied`);
    // V2 notification data is flat, as its response schema requires.
    const nested: string[] = [];
    for (const [field, value] of Object.entries(parsed ?? {})) {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) data[field] = value as string | number | boolean | null;
      else nested.push(field);
    }
    if (nested.length > 0) {
      warnings.push(`notification ${String(row.id)}: left out data fields that are not flat values: ${nested.join(', ')}`);
    }
    const createdAt = time(row.created_at, 0);
    // V1 kept only whether it was read; its creation is the earliest it can have been.
    return { id: String(row.id), userId: String(row.user_id), type: String(row.type), data, readAt: flag(row.is_read) ? createdAt : null, createdAt };
  });
}

function planProjects(v1: Database.Database, storageDir: string | undefined, files: FileToStore[], warnings: string[]): ProjectImport {
  const columns = new Set<string>(TASK_COLUMNS);
  const priorities = new Set<string>(TASK_PRIORITIES);
  const events = new Set<string>(PROJECT_ACTIVITY_EVENTS);
  const logColumn = (logId: string, value: string): TaskColumn => {
    if (columns.has(value)) return value as TaskColumn;
    warnings.push(`task log ${logId}: unknown column ${value} became backlog`);
    return 'backlog';
  };
  const attachments: ProjectImport['attachments'][number][] = [];
  for (const row of all(v1, 'SELECT * FROM task_attachments ORDER BY created_at, id')) {
    const id = String(row.id);
    const url = text(row.url);
    const file = storedFile(storageDir, url, 'task-attachments');
    if (file?.status !== 'found') {
      warnings.push(`task attachment ${id} (${url ?? 'no url'}) was left out: its file is ${file ? 'missing' : 'not a V1 upload'}`);
      continue;
    }
    const mimeType = text(row.mime_type) ?? 'image/webp';
    const storageKey = taskAttachmentStorageKey(id);
    files.push({ key: storageKey, source: file.path, contentType: mimeType });
    attachments.push({
      id,
      task_id: String(row.task_id),
      storage_key: storageKey,
      name: text(row.name) ?? `${id}.webp`,
      mime_type: mimeType,
      size: file.size,
      uploaded_by: text(row.uploaded_by),
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    });
  }

  return {
    projects: all(v1, 'SELECT * FROM projects ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: text(row.description),
      owner_id: String(row.owner_id),
      workspace_id: text(row.workspace_id),
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    })),
    members: all(v1, 'SELECT * FROM project_members ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      project_id: String(row.project_id),
      user_id: String(row.user_id),
      role: row.role === 'owner' ? 'owner' : 'member',
      created_at: time(row.created_at, 0),
    })),
    batches: all(v1, 'SELECT * FROM project_batches ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      project_id: String(row.project_id),
      major: Number(row.major),
      minor: Number(row.minor),
      label: text(row.label),
      is_active: flag(row.is_active) ? 1 : 0,
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    })),
    tasks: all(v1, 'SELECT * FROM tasks ORDER BY created_at, id').map((row) => {
      const id = String(row.id);
      let column = String(row.column_id);
      if (!columns.has(column)) {
        warnings.push(`task ${id}: unknown column ${column} became backlog`);
        column = 'backlog';
      }
      let priority = String(row.priority);
      if (!priorities.has(priority)) {
        warnings.push(`task ${id}: unknown priority ${priority} became medium`);
        priority = 'medium';
      }
      return {
        id,
        project_id: String(row.project_id),
        batch_id: text(row.batch_id),
        title: String(row.title),
        description: text(row.description),
        priority: priority as TaskPriority,
        assignee_id: text(row.assignee_id),
        column_id: column as TaskColumn,
        sort_order: Number(row.sort_order) || 0,
        version_major: Number(row.version_major),
        version_minor: Number(row.version_minor),
        version_patch: Number(row.version_patch),
        created_at: time(row.created_at, 0),
        updated_at: time(row.updated_at, 0),
      };
    }),
    taskLogs: all(v1, 'SELECT * FROM task_logs ORDER BY created_at, id').map((row) => {
      const id = String(row.id);
      const from = text(row.column_from);
      return {
        id,
        task_id: String(row.task_id),
        version: String(row.version),
        column_from: from === null ? null : logColumn(id, from),
        column_to: logColumn(id, String(row.column_to)),
        note: String(row.note ?? ''),
        created_by: text(row.created_by),
        created_at: time(row.created_at, 0),
      };
    }),
    activity: planActivity(v1, events, warnings),
    comments: all(v1, 'SELECT * FROM task_comments ORDER BY created_at, id').map((row) => ({
      id: String(row.id),
      task_id: String(row.task_id),
      user_id: text(row.user_id),
      content: String(row.content),
      created_at: time(row.created_at, 0),
      updated_at: time(row.updated_at, 0),
    })),
    attachments,
  };
}

/**
 * The task title V1's description names: `Task "<title>" dibuat` and
 * `Task "<title>" dipindah dari <from> → <to> (<version>)`
 * (V1 TaskController). Greedy up to the last such ending, so titles with
 * quotes survive.
 */
const V1_TASK_DESCRIPTION = /^Task "(.+)" (?:dibuat|dipindah dari )/;

/**
 * The project activity V2's feed can show. Event types V2 does not record
 * are left out and counted: V1's `task.log_added`, written by its +Log
 * button until that was removed on 2026-08-04. `meta` must be a JSON object, as the feed parses it.
 */
function planActivity(v1: Database.Database, events: ReadonlySet<string>, warnings: string[]): ProjectImport['activity'] {
  const leftOut = new Map<string, number>();
  const activity: ProjectImport['activity'][number][] = [];
  for (const row of all(v1, 'SELECT * FROM project_activity_logs ORDER BY created_at, id')) {
    const eventType = String(row.event_type);
    if (!events.has(eventType)) {
      leftOut.set(eventType, (leftOut.get(eventType) ?? 0) + 1);
      continue;
    }
    const id = String(row.id);
    let meta = text(row.meta);
    if (meta !== null && jsonObject(meta) === undefined) {
      warnings.push(`project activity ${id}: its meta was not a JSON object and was emptied`);
      meta = null;
    }
    // V1 nulls task_id when the task is deleted; its description is then all that names the task.
    const deletedTitle = text(row.task_id) === null ? V1_TASK_DESCRIPTION.exec(String(row.description))?.[1] : undefined;
    if (deletedTitle !== undefined) {
      meta = JSON.stringify({ ...(meta === null ? {} : jsonObject(meta)), task_title: deletedTitle });
    }
    activity.push({
      id,
      project_id: String(row.project_id),
      event_type: eventType as ProjectImport['activity'][number]['event_type'],
      description: String(row.description),
      actor_id: text(row.actor_id),
      task_id: text(row.task_id),
      batch_id: text(row.batch_id),
      meta,
      created_at: time(row.created_at, 0),
    });
  }
  if (leftOut.size > 0) {
    const total = [...leftOut.values()].reduce((sum, count) => sum + count, 0);
    const kinds = [...leftOut].sort(([left], [right]) => left.localeCompare(right)).map(([type, count]) => `${type} (${count})`);
    warnings.push(`${total} project activity entr${total === 1 ? 'y' : 'ies'} of event types V2 does not record were left out: ${kinds.join(', ')}`);
  }
  return activity;
}

function write(plan: ImportPlan): void {
  for (const { role, permissionIds } of plan.roles) createRoleWithPermissions(role, permissionIds);
  importAvatarAssets(plan.avatars);
  importAccounts(plan.accounts);
  importWorkspaceRows(plan.workspaces);
  importNotificationRows(plan.notifications);
  importProjectRows(plan.projects);
}

function counts(plan: ImportPlan): Record<string, number> {
  return {
    users: plan.accounts.length,
    roles: plan.roles.length,
    user_roles: plan.accounts.reduce((sum, account) => sum + new Set(account.roleIds).size, 0),
    assets: plan.avatars.length,
    workspaces: plan.workspaces.workspaces.length,
    workspace_members: plan.workspaces.members.length,
    workspace_invitations: plan.workspaces.invitations.length,
    workspace_messages: plan.workspaces.messages.length,
    notifications: plan.notifications.length,
    projects: plan.projects.projects.length,
    project_members: plan.projects.members.length,
    project_batches: plan.projects.batches.length,
    tasks: plan.projects.tasks.length,
    task_logs: plan.projects.taskLogs.length,
    project_activity_logs: plan.projects.activity.length,
    task_comments: plan.projects.comments.length,
    task_attachments: plan.projects.attachments.length,
    files: plan.files.length,
  };
}

/**
 * Imports a Macroma V1 database into this one through the owning features'
 * import functions, in one transaction. It reads only a temporary copy of
 * the V1 files. A dry run performs every write, rolls it back and stores no
 * file. Throws `V1ImportRefused`, before writing anything, when the source is
 * not a V1 database or the target is not empty of Macroma data.
 */
export async function importV1(options: V1ImportOptions, storage: AssetStorage): Promise<V1ImportReport> {
  const dryRun = options.dryRun ?? false;
  if (!existsSync(options.from)) throw new V1ImportRefused([`there is no V1 database at ${options.from}`]);
  if (options.storageDir !== undefined && !existsSync(options.storageDir)) {
    throw new V1ImportRefused([`there is no V1 storage directory at ${options.storageDir}`]);
  }

  const source = openV1Copy(options.from);
  try {
    const v1 = source.database;
    const schema = v1SchemaProblems(v1);
    if (schema.length > 0) throw new V1ImportRefused(schema);
    const target = targetProblems(v1);
    if (target.length > 0) throw new V1ImportRefused(target);

    const warnings: string[] = [];
    const files: FileToStore[] = [];
    if (!options.storageDir) warnings.push('no --storage directory was given, so no avatar or attachment file is imported');
    const { roles, roleIds } = planRoles(v1, warnings);
    const { accounts, avatars } = await planAccounts(v1, options.storageDir, roleIds, files, warnings);
    const plan: ImportPlan = {
      roles,
      avatars,
      accounts,
      workspaces: planWorkspaces(v1, warnings),
      notifications: planNotifications(v1, warnings),
      projects: planProjects(v1, options.storageDir, files, warnings),
      files,
      warnings,
    };
    const skipped = { sessions: count(v1, 'sessions'), password_reset_tokens: count(v1, 'password_reset_tokens') };

    const stored: string[] = [];
    try {
      if (!dryRun) {
        for (const file of plan.files) {
          await storage.put({ key: file.key, data: await readFile(file.source), contentType: file.contentType });
          stored.push(file.key);
        }
      }
      const database = getDatabase();
      database.transaction(() => {
        write(plan);
        if (dryRun) throw new DryRunRollback();
      })();
    } catch (error) {
      for (const key of stored) await storage.delete(key).catch(() => false);
      if (!(error instanceof DryRunRollback)) throw error;
    }
    return { dryRun, counts: counts(plan), skipped, warnings };
  } finally {
    source.close();
  }
}
