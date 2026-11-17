import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../../shared/database';
import {
  PROJECT_ACTIVITY_LIMIT,
  type ColumnCounts,
  type Project,
  type ProjectActivityEvent,
  type TaskColumn,
  type TaskPriority,
} from '../contract';

export type ProjectRole = 'owner' | 'member';

export interface MemberRow {
  user_id: string;
  role: ProjectRole;
  created_at: number;
}

export interface BatchRow {
  id: string;
  project_id: string;
  major: number;
  minor: number;
  label: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface TaskRow {
  id: string;
  project_id: string;
  batch_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignee_id: string | null;
  column_id: TaskColumn;
  sort_order: number;
  version_major: number;
  version_minor: number;
  version_patch: number;
  revision: number;
  revisi_count: number;
  comment_count: number;
  attachment_count: number;
  created_at: number;
  updated_at: number;
}

export interface CommentRow {
  id: string;
  task_id: string;
  user_id: string | null;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface AttachmentRow {
  id: string;
  task_id: string;
  storage_key: string;
  name: string;
  mime_type: string;
  size: number;
  uploaded_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskLogRow {
  id: string;
  task_id: string;
  version: string;
  column_from: TaskColumn | null;
  column_to: TaskColumn;
  note: string;
  created_by: string | null;
  created_at: number;
}

export interface ActivityRow {
  id: string;
  project_id: string;
  event_type: ProjectActivityEvent;
  description: string;
  actor_id: string | null;
  task_id: string | null;
  batch_id: string | null;
  meta: string | null;
  created_at: number;
}

const PROJECT_COLUMNS = 'p.id, p.name, p.description, p.owner_id, p.workspace_id, p.revision, p.created_at, p.updated_at';
const BATCH_COLUMNS = 'b.id, b.project_id, b.major, b.minor, b.label, b.is_active, b.created_at, b.updated_at';
// The derived counts come from grouped subqueries joined in, never a query per task.
const TASK_SELECT = `SELECT t.id, t.project_id, t.batch_id, t.title, t.description, t.priority, t.assignee_id, t.column_id,
    t.sort_order, t.version_major, t.version_minor, t.version_patch, t.revision, t.created_at, t.updated_at,
    COALESCE(r.revisi_count, 0) AS revisi_count,
    COALESCE(c.comment_count, 0) AS comment_count,
    COALESCE(a.attachment_count, 0) AS attachment_count
  FROM tasks t
  LEFT JOIN (
    SELECT task_id, COUNT(*) AS revisi_count FROM task_logs WHERE column_to = 'revisi' GROUP BY task_id
  ) r ON r.task_id = t.id
  LEFT JOIN (SELECT task_id, COUNT(*) AS comment_count FROM task_comments GROUP BY task_id) c ON c.task_id = t.id
  LEFT JOIN (SELECT task_id, COUNT(*) AS attachment_count FROM task_attachments GROUP BY task_id) a ON a.task_id = t.id`;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

export function emptyCounts(): ColumnCounts {
  return { backlog: 0, ongoing: 0, revisi: 0, review: 0, done: 0 };
}

/** `v1.2` for a batch, `v1.2.7` for a task version. */
export function versionString(major: number, minor: number, patch?: number): string {
  return patch === undefined ? `v${major}.${minor}` : `v${major}.${minor}.${patch}`;
}

function batchName(batch: Pick<BatchRow, 'major' | 'minor' | 'label'>): string {
  return `${versionString(batch.major, batch.minor)}${batch.label ? ` "${batch.label}"` : ''}`;
}

// --- Projects ---------------------------------------------------------------

export function findProject(id: string): Project | undefined {
  return getDatabase().prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = ?`).get(id) as Project | undefined;
}

export function createProject(input: { name: string; description: string | null; ownerId: string; workspaceId: string | null }): Project {
  const database = getDatabase();
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    owner_id: input.ownerId,
    workspace_id: input.workspaceId,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO projects (id, name, description, owner_id, workspace_id, revision, created_at, updated_at)
         VALUES (@id, @name, @description, @owner_id, @workspace_id, @revision, @created_at, @updated_at)`,
      )
      .run(project);
    addProjectMember(project.id, input.ownerId, 'owner', now);
    database
      .prepare('INSERT INTO project_version_counters (project_id, patch_counter, updated_at) VALUES (?, 0, ?)')
      .run(project.id, now);
    logActivity({
      projectId: project.id,
      eventType: 'project.created',
      description: `Project "${project.name}" created`,
      actorId: input.ownerId,
    });
  })();
  return project;
}

/**
 * The projects the account can open: those it is a member of and those in
 * its workspaces, newest first. `workspaceId` narrows them to one workspace.
 */
export function listProjectsFor(userId: string, workspaceIds: readonly string[], workspaceId?: string): Project[] {
  const filter = workspaceId === undefined ? '' : 'AND p.workspace_id = ?';
  const inWorkspaces = workspaceIds.length > 0 ? `OR p.workspace_id IN (${placeholders(workspaceIds)})` : '';
  return getDatabase()
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects p
       WHERE (p.id IN (SELECT project_id FROM project_members WHERE user_id = ?) ${inWorkspaces}) ${filter}
       ORDER BY p.created_at DESC, p.id`,
    )
    .all(userId, ...workspaceIds, ...(workspaceId === undefined ? [] : [workspaceId])) as Project[];
}

export type ProjectUpdate = { status: 'updated'; project: Project } | { status: 'stale'; project: Project } | { status: 'missing' };

export function updateProject(id: string, patch: { name?: string; description?: string | null }, revision: number): ProjectUpdate {
  const database = getDatabase();
  return database.transaction((): ProjectUpdate => {
    const current = findProject(id);
    if (!current) return { status: 'missing' };
    if (current.revision !== revision) return { status: 'stale', project: current };
    const next: Project = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      revision: current.revision + 1,
      updated_at: Date.now(),
    };
    database
      .prepare('UPDATE projects SET name = @name, description = @description, revision = @revision, updated_at = @updated_at WHERE id = @id')
      .run(next);
    return { status: 'updated', project: next };
  })();
}

/** Deletes the project with everything inside; returns the storage keys of the attachments that went with it. */
export function deleteProject(id: string): string[] {
  const database = getDatabase();
  return database.transaction(() => {
    const keys = attachmentKeysWhere('t.project_id = ?', [id]);
    database.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return keys;
  })();
}

function attachmentKeysWhere(condition: string, values: readonly unknown[]): string[] {
  return (
    getDatabase()
      .prepare(`SELECT a.storage_key FROM task_attachments a JOIN tasks t ON t.id = a.task_id WHERE ${condition}`)
      .all(...values) as Array<{ storage_key: string }>
  ).map((row) => row.storage_key);
}

export function directMembers(projectId: string): MemberRow[] {
  return getDatabase()
    .prepare('SELECT user_id, role, created_at FROM project_members WHERE project_id = ? ORDER BY created_at, rowid')
    .all(projectId) as MemberRow[];
}

export function directMemberRole(projectId: string, userId: string): ProjectRole | undefined {
  const row = getDatabase().prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId) as
    | { role: ProjectRole }
    | undefined;
  return row?.role;
}

/** Direct members of each project, in one query. */
export function directMemberIdsByProject(projectIds: readonly string[]): Map<string, string[]> {
  const members = new Map<string, string[]>();
  if (projectIds.length === 0) return members;
  const rows = getDatabase()
    .prepare(`SELECT project_id, user_id FROM project_members WHERE project_id IN (${placeholders(projectIds)})`)
    .all(...projectIds) as Array<{ project_id: string; user_id: string }>;
  for (const row of rows) members.set(row.project_id, [...(members.get(row.project_id) ?? []), row.user_id]);
  return members;
}

export function addProjectMember(projectId: string, userId: string, role: ProjectRole = 'member', now = Date.now()): void {
  getDatabase()
    .prepare(
      `INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
    )
    .run(randomUUID(), projectId, userId, role, now);
}

export function removeProjectMember(projectId: string, userId: string): boolean {
  return getDatabase().prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId).changes > 0;
}

/** Every task of each project per column, in one query. */
export function taskCountsByProject(projectIds: readonly string[]): Map<string, ColumnCounts> {
  const counts = new Map<string, ColumnCounts>();
  if (projectIds.length === 0) return counts;
  const rows = getDatabase()
    .prepare(
      `SELECT project_id, column_id, COUNT(*) AS count FROM tasks
       WHERE project_id IN (${placeholders(projectIds)}) GROUP BY project_id, column_id`,
    )
    .all(...projectIds) as Array<{ project_id: string; column_id: TaskColumn; count: number }>;
  for (const row of rows) {
    const projectCounts = counts.get(row.project_id) ?? emptyCounts();
    projectCounts[row.column_id] = row.count;
    counts.set(row.project_id, projectCounts);
  }
  return counts;
}

/** How many projects each workspace holds. */
export function projectCountsByWorkspace(workspaceIds: readonly string[]): Record<string, number> {
  if (workspaceIds.length === 0) return {};
  const rows = getDatabase()
    .prepare(
      `SELECT workspace_id, COUNT(*) AS count FROM projects
       WHERE workspace_id IN (${placeholders(workspaceIds)}) GROUP BY workspace_id`,
    )
    .all(...workspaceIds) as Array<{ workspace_id: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.workspace_id, row.count]));
}

/** The projects that live in the workspace. */
export function projectsInWorkspace(workspaceId: string): Project[] {
  return getDatabase().prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.workspace_id = ?`).all(workspaceId) as Project[];
}

/** Takes the accounts off every task of the project they are assigned to; answers whether any task changed. */
export function unassignTasks(projectId: string, userIds: readonly string[], now = Date.now()): boolean {
  if (userIds.length === 0) return false;
  return (
    getDatabase()
      .prepare(
        `UPDATE tasks SET assignee_id = NULL, revision = revision + 1, updated_at = ?
         WHERE project_id = ? AND assignee_id IN (${placeholders(userIds)})`,
      )
      .run(now, projectId, ...userIds).changes > 0
  );
}

/** The projects of a deleted workspace stay, without a workspace (V1's `ON DELETE SET NULL`). Returns them. */
export function detachWorkspaceRows(workspaceId: string): string[] {
  const database = getDatabase();
  const ids = (database.prepare('SELECT id FROM projects WHERE workspace_id = ?').all(workspaceId) as Array<{ id: string }>).map(
    (row) => row.id,
  );
  database.prepare('UPDATE projects SET workspace_id = NULL WHERE workspace_id = ?').run(workspaceId);
  return ids;
}

/** Projects owned by the accounts. */
export function projectIdsOwnedBy(userIds: readonly string[]): string[] {
  if (userIds.length === 0) return [];
  return (
    getDatabase()
      .prepare(`SELECT id FROM projects WHERE owner_id IN (${placeholders(userIds)})`)
      .all(...userIds) as Array<{ id: string }>
  ).map((row) => row.id);
}

/** Projects the accounts are direct members of. */
export function projectIdsWithMembers(userIds: readonly string[]): string[] {
  if (userIds.length === 0) return [];
  return (
    getDatabase()
      .prepare(`SELECT DISTINCT project_id FROM project_members WHERE user_id IN (${placeholders(userIds)})`)
      .all(...userIds) as Array<{ project_id: string }>
  ).map((row) => row.project_id);
}

/**
 * Removes what deleted accounts leave behind, as V1's foreign keys did:
 * the projects they owned go with everything inside, their memberships go,
 * and their names come off tasks, logs and the activity feed.
 */
/** Returns the storage keys of the attachments that went with the deleted projects. */
export function forgetAccountRows(userIds: readonly string[]): string[] {
  if (userIds.length === 0) return [];
  const database = getDatabase();
  const list = placeholders(userIds);
  return database.transaction(() => {
    const keys = attachmentKeysWhere(`t.project_id IN (SELECT id FROM projects WHERE owner_id IN (${list}))`, userIds);
    database.prepare(`DELETE FROM projects WHERE owner_id IN (${list})`).run(...userIds);
    database.prepare(`DELETE FROM project_members WHERE user_id IN (${list})`).run(...userIds);
    database.prepare(`UPDATE tasks SET assignee_id = NULL WHERE assignee_id IN (${list})`).run(...userIds);
    database.prepare(`UPDATE task_logs SET created_by = NULL WHERE created_by IN (${list})`).run(...userIds);
    database.prepare(`UPDATE project_activity_logs SET actor_id = NULL WHERE actor_id IN (${list})`).run(...userIds);
    database.prepare(`UPDATE task_comments SET user_id = NULL WHERE user_id IN (${list})`).run(...userIds);
    database.prepare(`UPDATE task_attachments SET uploaded_by = NULL WHERE uploaded_by IN (${list})`).run(...userIds);
    return keys;
  })();
}

// --- Batches ----------------------------------------------------------------

export function findBatch(id: string): BatchRow | undefined {
  return getDatabase().prepare(`SELECT ${BATCH_COLUMNS} FROM project_batches b WHERE b.id = ?`).get(id) as BatchRow | undefined;
}

/** Newest version first. */
export function listBatches(projectId: string): BatchRow[] {
  return getDatabase()
    .prepare(`SELECT ${BATCH_COLUMNS} FROM project_batches b WHERE b.project_id = ? ORDER BY b.major DESC, b.minor DESC, b.created_at DESC`)
    .all(projectId) as BatchRow[];
}

/** The active batch of each project, in one query. */
export function activeBatches(projectIds: readonly string[]): Map<string, BatchRow> {
  if (projectIds.length === 0) return new Map();
  const rows = getDatabase()
    .prepare(`SELECT ${BATCH_COLUMNS} FROM project_batches b WHERE b.is_active = 1 AND b.project_id IN (${placeholders(projectIds)})`)
    .all(...projectIds) as BatchRow[];
  return new Map(rows.map((row) => [row.project_id, row]));
}

/** Tasks of each batch per column, from one grouped query. */
export function countsByBatch(projectId: string): Map<string, ColumnCounts> {
  const counts = new Map<string, ColumnCounts>();
  const rows = getDatabase()
    .prepare(
      `SELECT batch_id, column_id, COUNT(*) AS count FROM tasks
       WHERE project_id = ? AND batch_id IS NOT NULL GROUP BY batch_id, column_id`,
    )
    .all(projectId) as Array<{ batch_id: string; column_id: TaskColumn; count: number }>;
  for (const row of rows) {
    const batchCounts = counts.get(row.batch_id) ?? emptyCounts();
    batchCounts[row.column_id] = row.count;
    counts.set(row.batch_id, batchCounts);
  }
  return counts;
}

// --- Releases ---------------------------------------------------------------

/** A batch as the releases view sees it, placed among the project's batches in opening order. */
export interface ReleaseRow {
  id: string;
  project_id: string;
  major: number;
  minor: number;
  label: string | null;
  is_active: 0 | 1;
  created_at: number;
  /** The next batch's opening. */
  next_opened_at: number | null;
  previous_major: number | null;
  task_count: number;
}

/** The project's batches, newest first, each with the next batch's opening, the previous major and its task count. */
export function listReleases(projectId: string): ReleaseRow[] {
  return getDatabase()
    .prepare(
      `SELECT b.id, b.project_id, b.major, b.minor, b.label, b.is_active, b.created_at,
         LEAD(b.created_at) OVER opening AS next_opened_at,
         LAG(b.major) OVER opening AS previous_major,
         COALESCE(t.task_count, 0) AS task_count
       FROM project_batches b
       LEFT JOIN (
         SELECT batch_id, COUNT(*) AS task_count FROM tasks WHERE project_id = ? AND batch_id IS NOT NULL GROUP BY batch_id
       ) t ON t.batch_id = b.id
       WHERE b.project_id = ?
       WINDOW opening AS (ORDER BY b.created_at, b.major, b.minor)
       ORDER BY b.created_at DESC, b.major DESC, b.minor DESC`,
    )
    .all(projectId, projectId) as ReleaseRow[];
}

/** How many of the batch's tasks moved to `revisi` at least once. */
export function revisiTaskCount(batchId: string): number {
  return (
    getDatabase()
      .prepare(
        `SELECT COUNT(DISTINCT l.task_id) AS count FROM task_logs l JOIN tasks t ON t.id = l.task_id
         WHERE t.batch_id = ? AND l.column_to = 'revisi'`,
      )
      .get(batchId) as { count: number }
  ).count;
}

export interface ChangelogRow {
  id: string;
  title: string;
  priority: TaskPriority;
  version_major: number;
  version_minor: number;
  version_patch: number;
  assignee_id: string | null;
  column_id: TaskColumn;
}

/** The batch's tasks, latest version first. */
export function changelogRows(batchId: string): ChangelogRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, title, priority, version_major, version_minor, version_patch, assignee_id, column_id FROM tasks
       WHERE batch_id = ? ORDER BY version_major DESC, version_minor DESC, version_patch DESC, created_at DESC, id`,
    )
    .all(batchId) as ChangelogRow[];
}

/** Each account assigned to, or with a logged change on, the batch's tasks, with how many distinct tasks. */
export function contributorCounts(batchId: string): Array<{ user_id: string; task_count: number }> {
  return getDatabase()
    .prepare(
      `SELECT user_id, COUNT(DISTINCT task_id) AS task_count FROM (
         SELECT id AS task_id, assignee_id AS user_id FROM tasks WHERE batch_id = ? AND assignee_id IS NOT NULL
         UNION
         SELECT l.task_id, l.created_by FROM task_logs l JOIN tasks t ON t.id = l.task_id
         WHERE t.batch_id = ? AND l.created_by IS NOT NULL
       ) GROUP BY user_id`,
    )
    .all(batchId, batchId) as Array<{ user_id: string; task_count: number }>;
}

function setActiveBatch(projectId: string, batchId: string, now: number): void {
  const database = getDatabase();
  database.prepare('UPDATE project_batches SET is_active = 0, updated_at = ? WHERE project_id = ? AND is_active = 1').run(now, projectId);
  database.prepare('UPDATE project_batches SET is_active = 1, updated_at = ? WHERE id = ?').run(now, batchId);
}

/**
 * Opens the next batch: the next minor version, or the next major one with
 * `bumpMajor`, with its own patch counter at zero. With `activate`, the
 * batch also becomes the active one.
 */
export function createBatch(
  projectId: string,
  input: { label: string | null; bumpMajor: boolean; activate: boolean },
  actorId: string,
): BatchRow {
  const database = getDatabase();
  return database.transaction((): BatchRow => {
    const latest = database
      .prepare('SELECT major, minor FROM project_batches WHERE project_id = ? ORDER BY major DESC, minor DESC LIMIT 1')
      .get(projectId) as { major: number; minor: number } | undefined;
    const major = !latest ? (input.bumpMajor ? 1 : 0) : input.bumpMajor ? latest.major + 1 : latest.major;
    const minor = !latest ? (input.bumpMajor ? 0 : 1) : input.bumpMajor ? 0 : latest.minor + 1;
    const now = Date.now();
    const batch: BatchRow = {
      id: randomUUID(),
      project_id: projectId,
      major,
      minor,
      label: input.label,
      is_active: 0,
      created_at: now,
      updated_at: now,
    };
    database
      .prepare(
        `INSERT INTO project_batches (id, project_id, major, minor, label, is_active, created_at, updated_at)
         VALUES (@id, @project_id, @major, @minor, @label, @is_active, @created_at, @updated_at)`,
      )
      .run(batch);
    logActivity({
      projectId,
      eventType: 'batch.created',
      description: `Batch ${batchName(batch)} created`,
      actorId,
      batchId: batch.id,
    });
    if (input.activate) {
      setActiveBatch(projectId, batch.id, now);
      batch.is_active = 1;
      logActivity({
        projectId,
        eventType: 'batch.activated',
        description: `Batch ${batchName(batch)} activated`,
        actorId,
        batchId: batch.id,
      });
    }
    return batch;
  })();
}

/** Makes the batch the project's only active one. */
export function activateBatch(batch: BatchRow, actorId: string): BatchRow {
  const database = getDatabase();
  return database.transaction((): BatchRow => {
    const now = Date.now();
    setActiveBatch(batch.project_id, batch.id, now);
    logActivity({
      projectId: batch.project_id,
      eventType: 'batch.activated',
      description: `Batch ${batchName(batch)} activated`,
      actorId,
      batchId: batch.id,
    });
    return { ...batch, is_active: 1, updated_at: now };
  })();
}

// --- Tasks ------------------------------------------------------------------

export function findTask(id: string): TaskRow | undefined {
  return getDatabase().prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
}

/** A project's board: every task, or the tasks of one batch, in column order. */
export function listTasks(projectId: string, batchId?: string): TaskRow[] {
  const filter = batchId === undefined ? '' : 'AND t.batch_id = ?';
  return getDatabase()
    .prepare(`${TASK_SELECT} WHERE t.project_id = ? ${filter} ORDER BY t.sort_order, t.created_at, t.id`)
    .all(projectId, ...(batchId === undefined ? [] : [batchId])) as TaskRow[];
}

function nextSortOrder(projectId: string, column: TaskColumn): number {
  const row = getDatabase()
    .prepare('SELECT MAX(sort_order) AS max FROM tasks WHERE project_id = ? AND column_id = ?')
    .get(projectId, column) as { max: number | null };
  return (row.max ?? 0) + 1;
}

/**
 * The next version of a change to a task: its batch's major.minor with the
 * batch's next patch, or v0.0.x from the project counter for a task outside
 * any batch. Runs inside the caller's transaction, so each patch is taken once.
 */
function nextVersion(projectId: string, batchId: string | null, now: number): { major: number; minor: number; patch: number } {
  const database = getDatabase();
  if (batchId) {
    const batch = database
      .prepare('UPDATE project_batches SET patch_counter = patch_counter + 1 WHERE id = ? RETURNING major, minor, patch_counter')
      .get(batchId) as { major: number; minor: number; patch_counter: number } | undefined;
    if (batch) return { major: batch.major, minor: batch.minor, patch: batch.patch_counter };
  }
  const row = database
    .prepare(
      `INSERT INTO project_version_counters (project_id, patch_counter, updated_at) VALUES (?, 1, ?)
       ON CONFLICT (project_id) DO UPDATE SET patch_counter = patch_counter + 1, updated_at = excluded.updated_at
       RETURNING patch_counter`,
    )
    .get(projectId, now) as { patch_counter: number };
  return { major: 0, minor: 0, patch: row.patch_counter };
}

function insertLog(log: TaskLogRow): void {
  getDatabase()
    .prepare(
      `INSERT INTO task_logs (id, task_id, version, column_from, column_to, note, created_by, created_at)
       VALUES (@id, @task_id, @version, @column_from, @column_to, @note, @created_by, @created_at)`,
    )
    .run(log);
}

export function createTask(input: {
  projectId: string;
  batchId: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  actorId: string;
}): TaskRow {
  const database = getDatabase();
  const id = database.transaction((): string => {
    const now = Date.now();
    const version = nextVersion(input.projectId, input.batchId, now);
    const taskId = randomUUID();
    database
      .prepare(
        `INSERT INTO tasks (id, project_id, batch_id, title, description, priority, assignee_id, column_id, sort_order,
           version_major, version_minor, version_patch, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        taskId,
        input.projectId,
        input.batchId,
        input.title,
        input.description,
        input.priority,
        input.assigneeId,
        nextSortOrder(input.projectId, 'backlog'),
        version.major,
        version.minor,
        version.patch,
        now,
        now,
      );
    const label = versionString(version.major, version.minor, version.patch);
    insertLog({
      id: randomUUID(),
      task_id: taskId,
      version: label,
      column_from: null,
      column_to: 'backlog',
      note: 'Task created',
      created_by: input.actorId,
      created_at: now,
    });
    logActivity({
      projectId: input.projectId,
      eventType: 'task.created',
      description: `Task "${input.title}" created`,
      actorId: input.actorId,
      taskId,
      meta: { version: label },
    });
    return taskId;
  })();
  return findTask(id) as TaskRow;
}

export type TaskUpdate = { status: 'updated'; task: TaskRow } | { status: 'stale'; task: TaskRow } | { status: 'missing' };

export function updateTask(
  id: string,
  patch: { title?: string; description?: string | null; priority?: TaskPriority; assigneeId?: string | null },
  revision: number,
  actorId: string,
): TaskUpdate {
  const database = getDatabase();
  return database.transaction((): TaskUpdate => {
    const current = findTask(id);
    if (!current) return { status: 'missing' };
    if (current.revision !== revision) return { status: 'stale', task: current };
    const next = {
      id,
      title: patch.title ?? current.title,
      description: patch.description === undefined ? current.description : patch.description,
      priority: patch.priority ?? current.priority,
      assignee_id: patch.assigneeId === undefined ? current.assignee_id : patch.assigneeId,
      revision: current.revision + 1,
      updated_at: Date.now(),
    };
    database
      .prepare(
        `UPDATE tasks SET title = @title, description = @description, priority = @priority, assignee_id = @assignee_id,
           revision = @revision, updated_at = @updated_at WHERE id = @id`,
      )
      .run(next);
    logActivity({
      projectId: current.project_id,
      eventType: 'task.updated',
      description: `Task "${next.title}" updated`,
      actorId,
      taskId: id,
    });
    return { status: 'updated', task: findTask(id) as TaskRow };
  })();
}

const COLUMN_NAMES: Record<TaskColumn, string> = {
  backlog: 'Backlog',
  ongoing: 'On Going',
  revisi: 'Revisi',
  review: 'Review',
  done: 'Done',
};

/** Moves the task to another column under its batch's next version, and logs it. */
export function moveTask(
  task: TaskRow,
  input: { column: TaskColumn; note: string; sortOrder?: number },
  actorId: string,
): { task: TaskRow; log: TaskLogRow } {
  const database = getDatabase();
  const log = database.transaction((): TaskLogRow => {
    const now = Date.now();
    const version = nextVersion(task.project_id, task.batch_id, now);
    const label = versionString(version.major, version.minor, version.patch);
    database
      .prepare(
        `UPDATE tasks SET column_id = ?, sort_order = ?, version_major = ?, version_minor = ?, version_patch = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.column,
        input.sortOrder ?? nextSortOrder(task.project_id, input.column),
        version.major,
        version.minor,
        version.patch,
        now,
        task.id,
      );
    const entry: TaskLogRow = {
      id: randomUUID(),
      task_id: task.id,
      version: label,
      column_from: task.column_id,
      column_to: input.column,
      note: input.note,
      created_by: actorId,
      created_at: now,
    };
    insertLog(entry);
    logActivity({
      projectId: task.project_id,
      eventType: 'task.moved',
      description: `Task "${task.title}" moved from ${COLUMN_NAMES[task.column_id]} to ${COLUMN_NAMES[input.column]} (${label})`,
      actorId,
      taskId: task.id,
      meta: { from: task.column_id, to: input.column, note: input.note, version: label },
    });
    return entry;
  })();
  return { task: findTask(task.id) as TaskRow, log };
}

/** Deletes the task; returns the storage keys of its attachments. */
export function deleteTask(task: TaskRow, actorId: string): string[] {
  const database = getDatabase();
  return database.transaction(() => {
    const keys = attachmentKeysWhere('t.id = ?', [task.id]);
    database.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    logActivity({
      projectId: task.project_id,
      eventType: 'task.deleted',
      description: `Task "${task.title}" deleted`,
      actorId,
    });
    return keys;
  })();
}

/** Every version the task went through, oldest first. */
export function listLogs(taskId: string): TaskLogRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, task_id, version, column_from, column_to, note, created_by, created_at
       FROM task_logs WHERE task_id = ? ORDER BY created_at, rowid`,
    )
    .all(taskId) as TaskLogRow[];
}

// --- Activity ---------------------------------------------------------------

export function logActivity(entry: {
  projectId: string;
  eventType: ProjectActivityEvent;
  description: string;
  actorId: string | null;
  taskId?: string | null;
  batchId?: string | null;
  meta?: Record<string, unknown> | null;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO project_activity_logs (id, project_id, event_type, description, actor_id, task_id, batch_id, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      entry.projectId,
      entry.eventType,
      entry.description,
      entry.actorId,
      entry.taskId ?? null,
      entry.batchId ?? null,
      entry.meta ? JSON.stringify(entry.meta) : null,
      Date.now(),
    );
}

/** The project's latest activity, newest first. */
export function listActivity(projectId: string, limit = PROJECT_ACTIVITY_LIMIT): ActivityRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, project_id, event_type, description, actor_id, task_id, batch_id, meta, created_at
       FROM project_activity_logs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(projectId, limit) as ActivityRow[];
}

// --- Comments ---------------------------------------------------------------

const COMMENT_COLUMNS = 'id, task_id, user_id, content, created_at, updated_at';

/** Oldest first, as a conversation reads. */
export function listComments(taskId: string): CommentRow[] {
  return getDatabase()
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM task_comments WHERE task_id = ? ORDER BY created_at, rowid`)
    .all(taskId) as CommentRow[];
}

export function findComment(id: string): CommentRow | undefined {
  return getDatabase().prepare(`SELECT ${COMMENT_COLUMNS} FROM task_comments WHERE id = ?`).get(id) as CommentRow | undefined;
}

export function createComment(input: { taskId: string; userId: string; content: string }): CommentRow {
  const now = Date.now();
  const row: CommentRow = { id: randomUUID(), task_id: input.taskId, user_id: input.userId, content: input.content, created_at: now, updated_at: now };
  getDatabase()
    .prepare(`INSERT INTO task_comments (${COMMENT_COLUMNS}) VALUES (@id, @task_id, @user_id, @content, @created_at, @updated_at)`)
    .run(row);
  return row;
}

export function deleteComment(id: string): void {
  getDatabase().prepare('DELETE FROM task_comments WHERE id = ?').run(id);
}

// --- Attachments ------------------------------------------------------------

const ATTACHMENT_COLUMNS = 'id, task_id, storage_key, name, mime_type, size, uploaded_by, created_at, updated_at';

/** Oldest first, in upload order. */
export function listAttachments(taskId: string): AttachmentRow[] {
  return getDatabase()
    .prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments WHERE task_id = ? ORDER BY created_at, rowid`)
    .all(taskId) as AttachmentRow[];
}

export function findAttachment(id: string): AttachmentRow | undefined {
  return getDatabase().prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
}

/** Records stored images of one upload in one transaction, with one activity entry for all of them. */
export function addAttachments(
  task: TaskRow,
  files: ReadonlyArray<{ id: string; storageKey: string; name: string; size: number }>,
  actorId: string,
): AttachmentRow[] {
  const database = getDatabase();
  const insert = database.prepare(
    `INSERT INTO task_attachments (${ATTACHMENT_COLUMNS})
     VALUES (@id, @task_id, @storage_key, @name, @mime_type, @size, @uploaded_by, @created_at, @updated_at)`,
  );
  return database.transaction(() => {
    const now = Date.now();
    const rows = files.map((file) => {
      const row: AttachmentRow = {
        id: file.id,
        task_id: task.id,
        storage_key: file.storageKey,
        name: file.name,
        mime_type: 'image/webp',
        size: file.size,
        uploaded_by: actorId,
        created_at: now,
        updated_at: now,
      };
      insert.run(row);
      return row;
    });
    logActivity({
      projectId: task.project_id,
      eventType: 'task.attachment_added',
      description: `${rows.length} image${rows.length === 1 ? '' : 's'} added to task "${task.title}"`,
      actorId,
      taskId: task.id,
      meta: { count: rows.length },
    });
    return rows;
  })();
}

export function deleteAttachment(task: TaskRow, attachment: AttachmentRow, actorId: string): void {
  const database = getDatabase();
  database.transaction(() => {
    database.prepare('DELETE FROM task_attachments WHERE id = ?').run(attachment.id);
    logActivity({
      projectId: task.project_id,
      eventType: 'task.attachment_removed',
      description: `Image removed from task "${task.title}"`,
      actorId,
      taskId: task.id,
      meta: { attachment_id: attachment.id },
    });
  })();
}
