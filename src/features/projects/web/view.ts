import type { PersonRef } from '../../../shared/ui';
import type {
  Batch as BatchRow,
  BatchRef as BatchRefRow,
  BoardHealth as BoardHealthApiRow,
  ColumnCounts,
  DashboardActivity as DashboardActivityRow,
  DashboardSuccess,
  ProjectPersonRef as PersonRefRow,
  ProjectSummary as ProjectSummaryRow,
  Task as TaskRow,
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
  url: string;
  name: string;
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
}

export interface Contributor {
  person: PersonRef;
  taskCount: number;
}

export interface ReleaseDetail extends ReleaseSummary {
  durationDays: number;
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
  /** The task title, or the project name where the API gives no task title. */
  subject: string;
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

export function toTaskLog(row: TaskLogRow): TaskLogEntry {
  return {
    id: row.id,
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

/**
 * An activity row. The API gives the task title only inside its English
 * `description`, so the line names the project instead; status and version
 * come from `meta` where the event records them.
 */
export function toActivityEntry(row: DashboardActivityRow, projectName: string): ActivityEntry {
  const to = row.meta?.to;
  const version = row.meta?.version;
  const moved = row.event_type === 'task.moved';
  return {
    id: row.id,
    actor: toPerson(row.actor, row.id),
    kind: moved && to === 'done' ? 'completed' : ACTIVITY_KINDS[row.event_type],
    subject: projectName,
    status: moved && isStatus(to) ? to : null,
    version: typeof version === 'string' ? parseTaskVersion(version) : null,
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
      activeProjects: stats.project_count,
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
