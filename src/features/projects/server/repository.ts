import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../../shared/database';
import type { PageCursor } from '../../../shared/security';
import {
  PROJECT_ACTIVITY_LIMIT,
  TASK_COLUMN_NAMES,
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
  /** Task events: the title recorded with the event, else the task's current one. */
  task_title: string | null;
  /** Batch events: `major.minor` recorded with the event, else the batch's current one. */
  batch_version: string | null;
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
    SELECT task_id, COUNT(*) AS revisi_count FROM task_logs WHERE column_to = 'revisi' AND column_from IS NOT column_to GROUP BY task_id
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

/** A batch's `major.minor`, as activity rows name it: `1.8`. */
function batchVersion(batch: Pick<BatchRow, 'major' | 'minor'>): string {
  return `${batch.major}.${batch.minor}`;
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
 * and their names come off tasks, logs and the activity feed. A task that
 * loses its assignee counts as edited, so `updated_since` syncs see it.
 * Returns the storage keys of the attachments that went with the deleted projects.
 */
export function forgetAccountRows(userIds: readonly string[], now = Date.now()): string[] {
  if (userIds.length === 0) return [];
  const database = getDatabase();
  const list = placeholders(userIds);
  return database.transaction(() => {
    const keys = attachmentKeysWhere(`t.project_id IN (SELECT id FROM projects WHERE owner_id IN (${list}))`, userIds);
    database.prepare(`DELETE FROM projects WHERE owner_id IN (${list})`).run(...userIds);
    database.prepare(`DELETE FROM project_members WHERE user_id IN (${list})`).run(...userIds);
    database
      .prepare(`UPDATE tasks SET assignee_id = NULL, revision = revision + 1, updated_at = ? WHERE assignee_id IN (${list})`)
      .run(now, ...userIds);
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

// --- Dashboard --------------------------------------------------------------

/** Tasks of the batches per column, in one query. */
export function countsByBatchIds(batchIds: readonly string[]): Map<string, ColumnCounts> {
  const counts = new Map<string, ColumnCounts>();
  if (batchIds.length === 0) return counts;
  const rows = getDatabase()
    .prepare(`SELECT batch_id, column_id, COUNT(*) AS count FROM tasks WHERE batch_id IN (${placeholders(batchIds)}) GROUP BY batch_id, column_id`)
    .all(...batchIds) as Array<{ batch_id: string; column_id: TaskColumn; count: number }>;
  for (const row of rows) {
    const batchCounts = counts.get(row.batch_id) ?? emptyCounts();
    batchCounts[row.column_id] = row.count;
    counts.set(row.batch_id, batchCounts);
  }
  return counts;
}

/**
 * A task log that moved the task (or created it), not a version entry that
 * stayed in its column, like a first batch adopting it.
 */
const MOVED = 'l.column_from IS NOT l.column_to';

/** Tasks of the projects now in `done` whose latest move into `done` falls in [from, to). */
export function doneBetween(projectIds: readonly string[], from: number, to: number): number {
  if (projectIds.length === 0) return 0;
  return (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks t
         WHERE t.project_id IN (${placeholders(projectIds)}) AND t.column_id = 'done'
           AND (SELECT MAX(l.created_at) FROM task_logs l WHERE l.task_id = t.id AND l.column_to = 'done' AND ${MOVED}) >= ?
           AND (SELECT MAX(l.created_at) FROM task_logs l WHERE l.task_id = t.id AND l.column_to = 'done' AND ${MOVED}) < ?`,
      )
      .get(...projectIds, from, to) as { count: number }
  ).count;
}

/** Tasks of the projects in `ongoing` assigned to the account. */
export function ongoingAssignedTo(projectIds: readonly string[], userId: string): number {
  if (projectIds.length === 0) return 0;
  return (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks
         WHERE project_id IN (${placeholders(projectIds)}) AND column_id = 'ongoing' AND assignee_id = ?`,
      )
      .get(...projectIds, userId) as { count: number }
  ).count;
}

/** Tasks of the projects in `revisi` that moved to `revisi` more than once. */
export function revisiRepeatedCount(projectIds: readonly string[]): number {
  if (projectIds.length === 0) return 0;
  return (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks t
         WHERE t.project_id IN (${placeholders(projectIds)}) AND t.column_id = 'revisi'
           AND (SELECT COUNT(*) FROM task_logs l WHERE l.task_id = t.id AND l.column_to = 'revisi' AND ${MOVED}) > 1`,
      )
      .get(...projectIds) as { count: number }
  ).count;
}

/**
 * Where the projects' tasks stood at each moment: per moment, every task
 * counted once in the column of its latest log at or before it.
 */
export function columnCountsAt(projectIds: readonly string[], moments: readonly number[]): Map<number, ColumnCounts> {
  const counts = new Map<number, ColumnCounts>(moments.map((moment) => [moment, emptyCounts()]));
  if (projectIds.length === 0 || moments.length === 0) return counts;
  const rows = getDatabase()
    .prepare(
      `WITH moments (moment) AS (VALUES ${moments.map(() => '(?)').join(', ')})
       SELECT moment, column_to, COUNT(*) AS count FROM (
         SELECT m.moment, l.column_to,
           ROW_NUMBER() OVER (PARTITION BY m.moment, l.task_id ORDER BY l.created_at DESC, l.rowid DESC) AS latest
         FROM moments m
         JOIN task_logs l ON l.created_at <= m.moment
         JOIN tasks t ON t.id = l.task_id
         WHERE t.project_id IN (${placeholders(projectIds)})
       ) WHERE latest = 1 GROUP BY moment, column_to`,
    )
    .all(...moments, ...projectIds) as Array<{ moment: number; column_to: TaskColumn; count: number }>;
  for (const row of rows) {
    const momentCounts = counts.get(row.moment);
    if (momentCounts) momentCounts[row.column_to] = row.count;
  }
  return counts;
}

/** The latest activity across the projects. */
export function recentActivity(projectIds: readonly string[], limit: number): ActivityRow[] {
  if (projectIds.length === 0) return [];
  return getDatabase()
    .prepare(`${ACTIVITY_SELECT} WHERE a.project_id IN (${placeholders(projectIds)}) ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`)
    .all(...projectIds, limit) as ActivityRow[];
}

// --- Releases ---------------------------------------------------------------

/**
 * A batch as the releases view sees it. Batches run in release order: the
 * activated ones by activation, then the planned (never activated) ones by
 * creation.
 */
export interface ReleaseRow {
  id: string;
  project_id: string;
  major: number;
  minor: number;
  label: string | null;
  is_active: 0 | 1;
  created_at: number;
  /** When the batch last became active; `null` while it was only planned. */
  activated_at: number | null;
  /** The next activation after this one. */
  next_activated_at: number | null;
  /** The major version of the batch before it in release order. */
  previous_major: number | null;
  task_count: number;
}

/** The project's batches, latest in release order first, each with its task count. */
export function listReleases(projectId: string): ReleaseRow[] {
  return getDatabase()
    .prepare(
      `SELECT b.id, b.project_id, b.major, b.minor, b.label, b.is_active, b.created_at, b.activated_at,
         LEAD(b.activated_at) OVER release AS next_activated_at,
         LAG(b.major) OVER release AS previous_major,
         COALESCE(t.task_count, 0) AS task_count
       FROM project_batches b
       LEFT JOIN (
         SELECT batch_id, COUNT(*) AS task_count FROM tasks WHERE project_id = ? AND batch_id IS NOT NULL GROUP BY batch_id
       ) t ON t.batch_id = b.id
       WHERE b.project_id = ?
       WINDOW release AS (ORDER BY b.activated_at IS NULL, b.activated_at, b.created_at, b.major, b.minor)
       ORDER BY b.activated_at IS NULL DESC, b.activated_at DESC, b.created_at DESC, b.major DESC, b.minor DESC`,
    )
    .all(projectId, projectId) as ReleaseRow[];
}

/** How many of the batch's tasks moved to `revisi` at least once. */
export function revisiTaskCount(batchId: string): number {
  return (
    getDatabase()
      .prepare(
        `SELECT COUNT(DISTINCT l.task_id) AS count FROM task_logs l JOIN tasks t ON t.id = l.task_id
         WHERE t.batch_id = ? AND l.column_to = 'revisi' AND ${MOVED}`,
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
  database.prepare('UPDATE project_batches SET is_active = 1, activated_at = ?, updated_at = ? WHERE id = ?').run(now, now, batchId);
}

/**
 * Makes the batch the project's active one. The project's first activation
 * ever (no batch of it has an `activated_at` yet) also adopts its batch-less
 * tasks; returns how many it adopted.
 */
function activateAndAdopt(batch: BatchRow, actorId: string, now: number): number {
  const activatedBefore = getDatabase()
    .prepare('SELECT 1 FROM project_batches WHERE project_id = ? AND activated_at IS NOT NULL LIMIT 1')
    .get(batch.project_id);
  setActiveBatch(batch.project_id, batch.id, now);
  return activatedBefore ? 0 : adoptBatchlessTasks(batch.project_id, batch, actorId, now);
}

/**
 * Opens the next batch: the next minor version, or the next major one with
 * `bumpMajor`, with its own patch counter at zero. With `activate`, the
 * batch also becomes the active one; when that is the project's first
 * activation, the batch adopts its batch-less tasks (see `activateAndAdopt`)
 * and `adopted` counts them.
 */
export function createBatch(
  projectId: string,
  input: { label: string | null; bumpMajor: boolean; activate: boolean },
  actorId: string,
): { batch: BatchRow; adopted: number } {
  const database = getDatabase();
  return database.transaction((): { batch: BatchRow; adopted: number } => {
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
    const adopted = input.activate ? activateAndAdopt(batch, actorId, now) : 0;
    if (input.activate) batch.is_active = 1;
    logActivity({
      projectId,
      eventType: 'batch.created',
      description: `Batch ${batchName(batch)} created`,
      actorId,
      batchId: batch.id,
      batchVersion: batchVersion(batch),
      meta: adopted > 0 ? { adopted_task_count: adopted } : null,
    });
    if (input.activate) {
      logActivity({
        projectId,
        eventType: 'batch.activated',
        description: `Batch ${batchName(batch)} activated`,
        actorId,
        batchId: batch.id,
        batchVersion: batchVersion(batch),
      });
    }
    return { batch, adopted };
  })();
}

/**
 * Moves every batch-less task of the project (v0.0.x) into the batch its
 * first activation made active, oldest version first. Each becomes a new
 * version of the batch (its next patch, as `nextVersion` takes it) with a
 * version-log entry that stays in its column, and its revision goes up.
 * Runs inside the activation's transaction.
 */
function adoptBatchlessTasks(projectId: string, batch: BatchRow, actorId: string, now: number): number {
  const database = getDatabase();
  const tasks = database
    .prepare(
      `SELECT id, column_id FROM tasks WHERE project_id = ? AND batch_id IS NULL
       ORDER BY version_major, version_minor, version_patch, created_at, id`,
    )
    .all(projectId) as Array<{ id: string; column_id: TaskColumn }>;
  const update = database.prepare(
    `UPDATE tasks SET batch_id = ?, version_major = ?, version_minor = ?, version_patch = ?, revision = revision + 1, updated_at = ?
     WHERE id = ?`,
  );
  const note = `Moved into batch ${versionString(batch.major, batch.minor)}`;
  for (const task of tasks) {
    const version = nextVersion(projectId, batch.id, now);
    update.run(batch.id, version.major, version.minor, version.patch, now, task.id);
    insertLog({
      id: randomUUID(),
      task_id: task.id,
      version: versionString(version.major, version.minor, version.patch),
      column_from: task.column_id,
      column_to: task.column_id,
      note,
      created_by: actorId,
      created_at: now,
    });
  }
  return tasks.length;
}

/**
 * Makes the batch the project's only active one; the project's first
 * activation adopts its batch-less tasks, counted in `adopted`.
 */
export function activateBatch(batch: BatchRow, actorId: string): { batch: BatchRow; adopted: number } {
  const database = getDatabase();
  return database.transaction((): { batch: BatchRow; adopted: number } => {
    const now = Date.now();
    const adopted = activateAndAdopt(batch, actorId, now);
    logActivity({
      projectId: batch.project_id,
      eventType: 'batch.activated',
      description: `Batch ${batchName(batch)} activated`,
      actorId,
      batchId: batch.id,
      batchVersion: batchVersion(batch),
      meta: adopted > 0 ? { adopted_task_count: adopted } : null,
    });
    return { batch: { ...batch, is_active: 1, updated_at: now }, adopted };
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

/**
 * The public API's task list: by `updated_at`, then `id`, after `after`, and
 * `limit + 1` rows so the caller knows whether another page follows.
 */
export function pageTasks(
  projectId: string,
  filter: { batchId?: string; columnId?: TaskColumn; assigneeId?: string; updatedSince?: number; after?: PageCursor },
  limit: number,
): TaskRow[] {
  // Only these fixed conditions are joined; every value is bound.
  const conditions = ['t.project_id = ?'];
  const values: Array<string | number> = [projectId];
  if (filter.batchId !== undefined) {
    conditions.push('t.batch_id = ?');
    values.push(filter.batchId);
  }
  if (filter.columnId !== undefined) {
    conditions.push('t.column_id = ?');
    values.push(filter.columnId);
  }
  if (filter.assigneeId !== undefined) {
    conditions.push('t.assignee_id = ?');
    values.push(filter.assigneeId);
  }
  if (filter.updatedSince !== undefined) {
    conditions.push('t.updated_at >= ?');
    values.push(filter.updatedSince);
  }
  if (filter.after) {
    conditions.push('(t.updated_at > ? OR (t.updated_at = ? AND t.id > ?))');
    values.push(filter.after.at, filter.after.at, filter.after.id);
  }
  return getDatabase()
    .prepare(`${TASK_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY t.updated_at, t.id LIMIT ?`)
    .all(...values, limit + 1) as TaskRow[];
}

export interface TaskDeletionRow {
  task_id: string;
  deleted_at: number;
}

/** The public API's deleted tasks: by `deleted_at` then id, from `since`, after `after`, and `limit + 1` rows. */
export function pageTaskDeletions(projectId: string, filter: { since?: number; after?: PageCursor }, limit: number): TaskDeletionRow[] {
  const conditions = ['project_id = ?'];
  const values: Array<string | number> = [projectId];
  if (filter.since !== undefined) {
    conditions.push('deleted_at >= ?');
    values.push(filter.since);
  }
  if (filter.after) {
    conditions.push('(deleted_at > ? OR (deleted_at = ? AND task_id > ?))');
    values.push(filter.after.at, filter.after.at, filter.after.id);
  }
  return getDatabase()
    .prepare(`SELECT task_id, deleted_at FROM task_deletions WHERE ${conditions.join(' AND ')} ORDER BY deleted_at, task_id LIMIT ?`)
    .all(...values, limit + 1) as TaskDeletionRow[];
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
      taskTitle: input.title,
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
      taskTitle: next.title,
    });
    return { status: 'updated', task: findTask(id) as TaskRow };
  })();
}

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
      description: `Task "${task.title}" moved from ${TASK_COLUMN_NAMES[task.column_id]} to ${TASK_COLUMN_NAMES[input.column]} (${label})`,
      actorId,
      taskId: task.id,
      taskTitle: task.title,
      meta: { from: task.column_id, to: input.column, note: input.note, version: label },
    });
    return entry;
  })();
  return { task: findTask(task.id) as TaskRow, log };
}

/**
 * Deletes the task and records when, so the public API can tell a syncing
 * client it is gone; returns the storage keys of its attachments.
 */
export function deleteTask(task: TaskRow, actorId: string): string[] {
  const database = getDatabase();
  return database.transaction(() => {
    const keys = attachmentKeysWhere('t.id = ?', [task.id]);
    database.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    database
      .prepare('INSERT INTO task_deletions (task_id, project_id, deleted_at) VALUES (?, ?, ?)')
      .run(task.id, task.project_id, Date.now());
    logActivity({
      projectId: task.project_id,
      eventType: 'task.deleted',
      description: `Task "${task.title}" deleted`,
      actorId,
      taskTitle: task.title,
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
  /** Task events: the title at the time, kept in `meta.task_title` so it outlives the task. */
  taskTitle?: string;
  /** Batch events: `major.minor` at the time, kept in `meta.batch_version`. */
  batchVersion?: string;
}): void {
  const meta = {
    ...entry.meta,
    ...(entry.taskTitle === undefined ? {} : { task_title: entry.taskTitle }),
    ...(entry.batchVersion === undefined ? {} : { batch_version: entry.batchVersion }),
  };
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
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
      Date.now(),
    );
}

/** A text field of the row's meta, or NULL when meta is missing, not JSON or the field is not text. */
function activityMetaText(field: 'task_title' | 'batch_version'): string {
  return `CASE WHEN json_valid(a.meta) AND json_type(a.meta, '$.${field}') = 'text' THEN json_extract(a.meta, '$.${field}') END`;
}

/**
 * Activity rows with the task and batch they name, one query for any number of
 * rows: what was recorded with the event, else (rows recorded before, V1
 * imports) the task's current title and the batch's current version.
 */
const ACTIVITY_SELECT = `
  SELECT a.id, a.project_id, a.event_type, a.description, a.actor_id, a.task_id, a.batch_id, a.meta, a.created_at,
    CASE WHEN a.event_type LIKE 'task.%' THEN COALESCE(${activityMetaText('task_title')}, t.title) END AS task_title,
    CASE WHEN a.event_type LIKE 'batch.%' THEN COALESCE(${activityMetaText('batch_version')}, b.major || '.' || b.minor) END AS batch_version
  FROM project_activity_logs a
  LEFT JOIN tasks t ON t.id = a.task_id
  LEFT JOIN project_batches b ON b.id = a.batch_id`;

/** The project's latest activity, newest first. */
export function listActivity(projectId: string, limit = PROJECT_ACTIVITY_LIMIT): ActivityRow[] {
  return getDatabase()
    .prepare(`${ACTIVITY_SELECT} WHERE a.project_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`)
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

/** The public API's comment list: oldest first, after `after`, and `limit + 1` rows. */
export function pageComments(taskId: string, after: PageCursor | undefined, limit: number): CommentRow[] {
  const resume = after ? 'AND (created_at > ? OR (created_at = ? AND id > ?))' : '';
  return getDatabase()
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM task_comments WHERE task_id = ? ${resume} ORDER BY created_at, id LIMIT ?`)
    .all(taskId, ...(after ? [after.at, after.at, after.id] : []), limit + 1) as CommentRow[];
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
      taskTitle: task.title,
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
      taskTitle: task.title,
      meta: { attachment_id: attachment.id },
    });
  })();
}

/**
 * Projects and everything in them carried over from another installation, as
 * table rows. The counters and activation times are derived on import.
 */
export interface ProjectImport {
  projects: ReadonlyArray<Omit<Project, 'revision'>>;
  members: ReadonlyArray<MemberRow & { id: string; project_id: string }>;
  batches: readonly BatchRow[];
  tasks: ReadonlyArray<Omit<TaskRow, 'revision' | 'revisi_count' | 'comment_count' | 'attachment_count'>>;
  taskLogs: readonly TaskLogRow[];
  /** The task title and batch version each row names are filled in from the imported tasks and batches. */
  activity: ReadonlyArray<Omit<ActivityRow, 'task_title' | 'batch_version'>>;
  comments: readonly CommentRow[];
  attachments: readonly AttachmentRow[];
}

/** How many rows the Projects tables hold; an import only goes into empty ones. */
export function countProjectRows(): number {
  return (
    getDatabase()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM project_members) + (SELECT COUNT(*) FROM project_batches)
           + (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM task_logs) + (SELECT COUNT(*) FROM project_activity_logs)
           + (SELECT COUNT(*) FROM task_comments) + (SELECT COUNT(*) FROM task_attachments) AS count`,
      )
      .get() as { count: number }
  ).count;
}

/**
 * Writes imported rows with their ids, versions and timestamps, inside the
 * caller's transaction, and announces nothing. Then, per project:
 * - each batch continues after the highest patch its tasks carry in its own
 *   version line, and the project counter after its unbatched v0.0 tasks;
 * - a batch's `activated_at` is its latest `batch.activated` activity entry.
 *   A batch without one counts as activated at its creation when it is the
 *   active batch or was opened before it (the rule of migration 0304), and
 *   the active batch always ends up with the latest activation;
 * - each activity row records the task title and batch version it names, from
 *   the same fallback the activity feed reads, so they outlive later deletes.
 */
export function importProjectRows(rows: ProjectImport): void {
  const database = getDatabase();
  const insert = (table: string, columns: readonly string[]) =>
    database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`);
  const project = insert('projects', ['id', 'name', 'description', 'owner_id', 'workspace_id', 'created_at', 'updated_at']);
  const member = insert('project_members', ['id', 'project_id', 'user_id', 'role', 'created_at']);
  const batch = insert('project_batches', ['id', 'project_id', 'major', 'minor', 'label', 'is_active', 'created_at', 'updated_at']);
  const task = insert('tasks', [
    'id', 'project_id', 'batch_id', 'title', 'description', 'priority', 'assignee_id', 'column_id', 'sort_order',
    'version_major', 'version_minor', 'version_patch', 'created_at', 'updated_at',
  ]);
  const taskLog = insert('task_logs', ['id', 'task_id', 'version', 'column_from', 'column_to', 'note', 'created_by', 'created_at']);
  const activity = insert('project_activity_logs', [
    'id', 'project_id', 'event_type', 'description', 'actor_id', 'task_id', 'batch_id', 'meta', 'created_at',
  ]);
  const comment = insert('task_comments', ['id', 'task_id', 'user_id', 'content', 'created_at', 'updated_at']);
  const attachment = insert('task_attachments', [
    'id', 'task_id', 'storage_key', 'name', 'mime_type', 'size', 'uploaded_by', 'created_at', 'updated_at',
  ]);
  const counter = database.prepare(
    `INSERT INTO project_version_counters (project_id, patch_counter, updated_at)
     SELECT p.id, COALESCE((
       SELECT MAX(t.version_patch) FROM tasks t
       WHERE t.project_id = p.id AND t.batch_id IS NULL AND t.version_major = 0 AND t.version_minor = 0
     ), 0), p.updated_at
     FROM projects p WHERE p.id = ?`,
  );
  const batchCounters = database.prepare(
    `UPDATE project_batches
     SET patch_counter = COALESCE((
       SELECT MAX(t.version_patch) FROM tasks t
       WHERE t.batch_id = project_batches.id AND t.version_major = project_batches.major AND t.version_minor = project_batches.minor
     ), 0)
     WHERE project_id = ?`,
  );
  const loggedActivations = database.prepare(
    `UPDATE project_batches
     SET activated_at = (
       SELECT MAX(a.created_at) FROM project_activity_logs a
       WHERE a.batch_id = project_batches.id AND a.event_type = 'batch.activated'
     )
     WHERE project_id = ?`,
  );
  const unloggedActivations = database.prepare(
    `UPDATE project_batches
     SET activated_at = created_at
     WHERE project_id = ? AND activated_at IS NULL
       AND EXISTS (
         SELECT 1 FROM project_batches active
         WHERE active.project_id = project_batches.project_id AND active.is_active = 1
           AND (project_batches.created_at, project_batches.major, project_batches.minor) <= (active.created_at, active.major, active.minor)
       )`,
  );
  const activeIsLatest = database.prepare(
    `UPDATE project_batches
     SET activated_at = (SELECT MAX(other.activated_at) + 1 FROM project_batches other WHERE other.project_id = project_batches.project_id AND other.id <> project_batches.id)
     WHERE project_id = ? AND is_active = 1
       AND activated_at <= (SELECT MAX(other.activated_at) FROM project_batches other WHERE other.project_id = project_batches.project_id AND other.id <> project_batches.id)`,
  );
  const namedActivity = database.prepare(`${ACTIVITY_SELECT} WHERE a.project_id = ?`);
  const activityMeta = database.prepare('UPDATE project_activity_logs SET meta = ? WHERE id = ?');
  database.transaction(() => {
    for (const row of rows.projects) project.run(row);
    for (const row of rows.members) member.run(row);
    for (const row of rows.batches) batch.run(row);
    for (const row of rows.tasks) task.run(row);
    for (const row of rows.taskLogs) taskLog.run(row);
    for (const row of rows.activity) activity.run(row);
    for (const row of rows.comments) comment.run(row);
    for (const row of rows.attachments) attachment.run(row);
    for (const { id } of rows.projects) {
      counter.run(id);
      batchCounters.run(id);
      loggedActivations.run(id);
      unloggedActivations.run(id);
      activeIsLatest.run(id);
      for (const row of namedActivity.all(id) as ActivityRow[]) {
        if (row.task_title === null && row.batch_version === null) continue;
        // The import keeps only meta that is a JSON object.
        const meta = row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {};
        if (row.task_title !== null) meta.task_title = row.task_title;
        if (row.batch_version !== null) meta.batch_version = row.batch_version;
        activityMeta.run(JSON.stringify(meta), row.id);
      }
    }
  })();
}
