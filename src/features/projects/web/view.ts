import type { PersonRef } from '../../../shared/ui';
import type {
  ActiveRelease as ActiveReleaseRow,
  Batch as BatchRow,
  BatchRef as BatchRefRow,
  BoardHealth as BoardHealthApiRow,
  ColumnCounts,
  DashboardActivity as DashboardActivityRow,
  DashboardSuccess,
  ProjectPersonRef as PersonRefRow,
  ProjectSummary as ProjectSummaryRow,
  Release as ReleaseRow,
  ReleaseDetailSuccess,
  Task as TaskRow,
  TaskAttachment as TaskAttachmentRow,
  TaskComment as TaskCommentRow,
  TaskDetail as TaskDetailRow,
  TaskLog as TaskLogRow,
} from '../contract';

/*
 * Shapes the projects pages and components render. API rows (snake_case)
 * become these camelCase shapes only through the mappers below; components
 * never read API rows.
 */

export type TaskStatus = 'backlog' | 'ongoing' | 'revisi' | 'review' | 'done';
export const TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'ongoing', 'revisi', 'review', 'done'];

export type TaskPriority = 'low' | 'medium' | 'high';

export interface BatchVersion {
  major: number;
  minor: number;
}
export interface TaskVersion extends BatchVersion {
  patch: number;
}

export type StatusCounts = Record<TaskStatus, number>;

export type ProjectRole = 'owner' | 'member';

export interface TaskCardData {
  id: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  version: TaskVersion;
  commentCount: number;
  attachmentCount: number;
  assignee?: PersonRef | null;
  /** How many times the task moved to Revisi. */
  revisiCount: number;
  /** The batch the task is versioned under; `null` outside any batch (v0.0.x). */
  batchId?: string | null;
  /** The revision an edit is based on. */
  revision?: number;
}

export interface BatchSummary extends BatchVersion {
  id: string;
  label: string;
  openedAt: string;
  isActive: boolean;
  counts: StatusCounts;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  workspaceId?: string | null;
  workspaceName?: string;
  /** Version of the project's active batch. */
  batch?: BatchVersion | null;
  /** The signed-in account's role in it. */
  role?: ProjectRole;
  revision?: number;
  /** Every task of the project per status. */
  taskCounts?: StatusCounts;
  memberCount?: number;
}

export interface TaskLogEntry {
  id: string;
  /**
   * `move`: the task went from one column to another (or was created).
   * `adopt`: the project's first Bump versi took this batch-less task into the
   * new batch. The API marks it `kind: "batch_adopted"`; entries without a
   * `kind` show it by the same column on both sides, which a real move never
   * has (same-column moves are refused).
   * `note`: a note on the task (`kind: "note"`), with no move to show.
   */
  kind: 'move' | 'adopt' | 'note';
  version: TaskVersion;
  from: TaskStatus | null;
  to: TaskStatus;
  note: string;
  author: PersonRef;
  at: string;
}

export interface TaskComment {
  id: string;
  author: PersonRef;
  body: string;
  at: string;
}

export interface TaskImage {
  id: string;
  /** The API's guarded file route: only accounts that can open the project get the image. */
  url: string;
  name: string;
  /** `null` once the uploader's account is deleted. */
  uploaderId: string | null;
}

/** Tabs of the task detail modal. */
export type TaskDetailTab = 'detail' | 'comments' | 'history' | 'images';

export interface TaskDetailData extends TaskCardData {
  projectName: string;
  /** `null` for a task outside any batch. */
  batch: BatchVersion | null;
  createdAt: string;
  /** `null` once the creator's account is deleted. */
  createdBy: PersonRef | null;
  updatedAt: string;
  logs: TaskLogEntry[];
}

export interface NewTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string;
  files: File[];
}

/** The fields "Edit task" changes; `assigneeId` is '' for nobody. */
export type EditTaskForm = {
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string;
};
export type EditTaskField = keyof EditTaskForm;

export interface MoveTaskInput {
  taskId: string;
  to: TaskStatus;
  note: string;
}

export type BumpKind = 'minor' | 'major';

/** The project's highest batch version, which a bump counts on; `null` before its first batch. */
export function latestBatchVersion(batches: readonly BatchVersion[]): BatchVersion | null {
  return batches.reduce<BatchVersion | null>(
    (highest, batch) =>
      !highest || batch.major > highest.major || (batch.major === highest.major && batch.minor > highest.minor)
        ? { major: batch.major, minor: batch.minor }
        : highest,
    null,
  );
}

/** The batch Bump versi opens: the next minor or major after `latest`, or v0.1 / v1.0 as a project's first. */
export function nextBatchVersion(latest: BatchVersion | null, kind: BumpKind): BatchVersion {
  if (kind === 'major') return { major: (latest?.major ?? 0) + 1, minor: 0 };
  return latest ? { major: latest.major, minor: latest.minor + 1 } : { major: 0, minor: 1 };
}

export interface ReleaseSummary extends BatchVersion {
  id: string;
  label: string;
  openedAt: string;
  closedAt: string;
  taskCount: number;
  isMajor: boolean;
}

export interface ChangelogEntry {
  id: string;
  title: string;
  priority: TaskPriority;
  version: TaskVersion;
  assignee?: PersonRef | null;
  /** The task's column now. */
  status: TaskStatus;
}

export interface Contributor {
  person: PersonRef;
  taskCount: number;
}

/** The release shown on the right of Rilis: a closed batch, or the active one when the URL names it. */
export interface ReleaseDetail extends BatchVersion {
  id: string;
  label: string;
  /** `null` for a planned batch that was never active. */
  openedAt: string | null;
  /** `null` while the batch is active or planned. */
  closedAt: string | null;
  taskCount: number;
  isMajor: boolean;
  isActive: boolean;
  /** Whole days from opening to closing; `null` until the batch closes. */
  durationDays: number | null;
  revisiTaskCount: number;
  changelog: ChangelogEntry[];
  contributors: Contributor[];
}

/** What an activity line says happened. */
export type ActivityKind =
  | 'project-created'
  | 'created'
  | 'moved'
  | 'completed'
  | 'edited'
  | 'deleted'
  | 'batch-created'
  | 'bumped'
  | 'image-added'
  | 'image-removed'
  | 'commented';

/** One line of the activity feed: who did what, in which project or to which task. */
export interface ActivityEntry {
  id: string;
  actor: PersonRef;
  kind: ActivityKind;
  /** The project the event happened in. */
  subject: string;
  /** The task's title for task events; `null` on rows recorded without one, which name the project instead. */
  task: string | null;
  status?: TaskStatus | null;
  version?: BatchVersion | TaskVersion | null;
  at: string;
}

export interface DashboardStats {
  activeTasks: number;
  activeProjects: number;
  ongoing: number;
  ongoingMine?: number | null;
  revisi: number;
  revisiRepeated?: number | null;
  doneThisWeek: number;
  doneLastWeek?: number | null;
}

export interface BoardHealthRow {
  project: Pick<ProjectSummary, 'id' | 'name'>;
  /** `null` while the project has no active batch: the counts are then the whole project's. */
  batch: BatchVersion | null;
  counts: StatusCounts;
}

export interface DashboardData {
  workspaceCount: number;
  stats: DashboardStats;
  health: BoardHealthRow[];
  activity: ActivityEntry[];
}

export interface NewProjectInput {
  name: string;
  description: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A person whose account was deleted keeps their line under a placeholder name. */
function toPerson(row: PersonRefRow | null, fallbackId: string): PersonRef {
  return row ? { id: row.id, name: row.name, avatar: row.avatar } : { id: `gone-${fallbackId}`, name: 'Akun terhapus' };
}

function toCounts(row: ColumnCounts): StatusCounts {
  return { backlog: row.backlog, ongoing: row.ongoing, revisi: row.revisi, review: row.review, done: row.done };
}

function toBatchVersion(row: BatchRefRow): BatchVersion {
  return { major: row.major, minor: row.minor };
}

/** `v1.2.7` as the task log stores it. */
export function parseTaskVersion(label: string): TaskVersion {
  const [major = 0, minor = 0, patch = 0] = label.replace(/^v/, '').split('.').map(Number);
  return { major, minor, patch };
}

export function toProjectSummary(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    workspaceId: row.workspace_id,
    batch: row.active_batch ? toBatchVersion(row.active_batch) : null,
    role: row.role,
    revision: row.revision,
    taskCounts: toCounts(row.task_counts),
    memberCount: row.member_count,
  };
}

export function toBatchSummary(row: BatchRow): BatchSummary {
  return {
    id: row.id,
    major: row.major,
    minor: row.minor,
    label: row.label ?? '',
    openedAt: iso(row.created_at),
    isActive: row.is_active,
    counts: toCounts(row.counts),
  };
}

/** The active batch on Rilis, in the shape the board's batch strip uses too. */
export function toActiveRelease(row: ActiveReleaseRow): BatchSummary {
  return {
    id: row.id,
    major: row.major,
    minor: row.minor,
    label: row.label ?? '',
    openedAt: iso(row.opened_at),
    isActive: true,
    counts: toCounts(row.counts),
  };
}

export function toRelease(row: ReleaseRow): ReleaseSummary {
  return {
    id: row.id,
    major: row.major,
    minor: row.minor,
    label: row.label ?? '',
    openedAt: iso(row.opened_at),
    closedAt: iso(row.closed_at),
    taskCount: row.task_count,
    isMajor: row.major_bump,
  };
}

export function toReleaseDetail(data: ReleaseDetailSuccess['data']): ReleaseDetail {
  const { batch, stats } = data;
  return {
    id: batch.id,
    major: batch.major,
    minor: batch.minor,
    label: batch.label ?? '',
    openedAt: batch.opened_at === null ? null : iso(batch.opened_at),
    closedAt: batch.closed_at === null ? null : iso(batch.closed_at),
    taskCount: stats.task_count,
    isMajor: batch.major_bump,
    isActive: batch.is_active,
    durationDays: stats.duration_days,
    revisiTaskCount: stats.revisi_task_count,
    changelog: data.changelog.map((entry) => ({
      id: entry.task_id,
      title: entry.title,
      priority: entry.priority,
      version: { ...entry.version },
      assignee: entry.assignee ? toPerson(entry.assignee, entry.task_id) : null,
      status: entry.column_id,
    })),
    contributors: data.contributors.map((contributor) => ({
      person: { id: contributor.user.id, name: contributor.user.name || contributor.user.email, avatar: contributor.user.avatar },
      taskCount: contributor.task_count,
    })),
  };
}

export function toTaskCard(row: TaskRow): TaskCardData {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.column_id,
    version: { ...row.version },
    commentCount: row.comment_count,
    attachmentCount: row.attachment_count,
    assignee: row.assignee ? toPerson(row.assignee, row.id) : null,
    revisiCount: row.revisi_count,
    batchId: row.batch_id,
    revision: row.revision,
  };
}

function taskLogKind(row: TaskLogRow): TaskLogEntry['kind'] {
  if (row.kind === 'batch_adopted') return 'adopt';
  if (row.kind === 'note') return 'note';
  if (row.kind === undefined && row.column_from !== null && row.column_from === row.column_to) return 'adopt';
  return 'move';
}

export function toTaskLog(row: TaskLogRow): TaskLogEntry {
  return {
    id: row.id,
    kind: taskLogKind(row),
    version: parseTaskVersion(row.version),
    from: row.column_from,
    to: row.column_to,
    note: row.note,
    author: toPerson(row.user, row.id),
    at: iso(row.created_at),
  };
}

export function toTaskDetail(row: TaskDetailRow): TaskDetailData {
  return {
    ...toTaskCard(row),
    projectName: row.project.name,
    batch: row.batch ? toBatchVersion(row.batch) : null,
    createdAt: iso(row.created_at),
    createdBy: row.created_by ? toPerson(row.created_by, row.id) : null,
    updatedAt: iso(row.updated_at),
    logs: row.logs.map(toTaskLog),
  };
}

/**
 * The version a task's next change gets, by the API's rule: its batch's
 * major.minor with the batch's next patch (v0.0.x outside any batch, from the
 * project's own counter). The API does not expose the counters, so the next
 * patch is read off the highest version among `tasks` of the same batch; it
 * runs low only when that task was deleted. The saved version always comes
 * back from the API.
 */
export function nextTaskVersion(batch: BatchVersion | null, batchId: string | null, tasks: readonly TaskCardData[]): TaskVersion {
  const base = batch ?? { major: 0, minor: 0 };
  const patch = tasks
    .filter((task) => (task.batchId ?? null) === batchId)
    .reduce((highest, task) => Math.max(highest, task.version.patch), 0);
  return { major: base.major, minor: base.minor, patch: patch + 1 };
}

function toBoardHealth(row: BoardHealthApiRow): BoardHealthRow {
  return {
    project: { id: row.project_id, name: row.name },
    batch: row.active_batch ? toBatchVersion(row.active_batch) : null,
    counts: toCounts(row.counts),
  };
}

const ACTIVITY_KINDS: Record<DashboardActivityRow['event_type'], ActivityKind> = {
  'project.created': 'project-created',
  'task.created': 'created',
  'task.moved': 'moved',
  'task.updated': 'edited',
  'task.deleted': 'deleted',
  'batch.created': 'batch-created',
  'batch.activated': 'bumped',
  'task.attachment_added': 'image-added',
  'task.attachment_removed': 'image-removed',
};

const isStatus = (value: unknown): value is TaskStatus => typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);

/** A batch's `major.minor` as the activity feed writes it (`1.8`, no `v`). */
function parseBatchVersion(label: string | null): BatchVersion | null {
  const match = label === null ? null : /^(\d+)\.(\d+)$/.exec(label);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/**
 * An activity row: the task by `task_title` and a batch event's version by
 * `batch_version`, each `null` on rows recorded without them; status and a
 * task's version come from `meta` where the event records them.
 */
export function toActivityEntry(row: DashboardActivityRow, projectName: string): ActivityEntry {
  const to = row.meta?.to;
  const version = row.meta?.version;
  const moved = row.event_type === 'task.moved';
  const batchVersion = parseBatchVersion(row.batch_version);
  return {
    id: row.id,
    actor: toPerson(row.actor, row.id),
    kind: moved && to === 'done' ? 'completed' : ACTIVITY_KINDS[row.event_type],
    subject: projectName,
    task: row.task_title,
    status: moved && isStatus(to) ? to : null,
    version: batchVersion ?? (typeof version === 'string' ? parseTaskVersion(version) : null),
    at: iso(row.created_at),
  };
}

export function toDashboard(data: DashboardSuccess['data']): DashboardData {
  const { stats } = data;
  const names = new Map(data.projects.map((project) => [project.id, project.name]));
  for (const row of data.board_health) names.set(row.project_id, row.name);
  return {
    workspaceCount: stats.workspace_count,
    stats: {
      activeTasks: stats.counts.ongoing + stats.counts.revisi + stats.counts.review,
      activeProjects: stats.active_project_count,
      ongoing: stats.counts.ongoing,
      ongoingMine: stats.ongoing_mine,
      revisi: stats.counts.revisi,
      revisiRepeated: stats.revisi_repeated,
      doneThisWeek: stats.done_this_week,
      doneLastWeek: stats.done_last_week,
    },
    health: data.board_health.map(toBoardHealth),
    activity: data.recent_activity.map((row) => toActivityEntry(row, names.get(row.project_id) ?? 'project')),
  };
}

export function toTaskComment(row: TaskCommentRow): TaskComment {
  return { id: row.id, author: toPerson(row.user, row.id), body: row.content, at: iso(row.created_at) };
}

export function toTaskImage(row: TaskAttachmentRow): TaskImage {
  return { id: row.id, url: row.url, name: row.name, uploaderId: row.uploaded_by?.id ?? null };
}
