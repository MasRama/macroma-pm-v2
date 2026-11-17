import type { PersonRef } from '../../../shared/ui';

/*
 * Shapes the projects pages and components render. They follow the data the
 * approved design shows (SPEC.md "Data used"); the API client maps its
 * responses onto them when the pages are wired to the backend.
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

export interface TaskCardData {
  id: number;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  version: TaskVersion;
  commentCount: number;
  attachmentCount: number;
  assignee?: PersonRef | null;
  /** How many times the task moved to Revisi (derived from its logs). */
  revisiCount: number;
}

export interface BatchSummary extends BatchVersion {
  id: number;
  label: string;
  openedAt: string;
  isActive: boolean;
  counts: StatusCounts;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description?: string | null;
  workspaceName?: string;
  /** Version of the project's active batch. */
  batch?: BatchVersion | null;
}

export interface TaskLogEntry {
  id: number;
  version: TaskVersion;
  from: TaskStatus | null;
  to: TaskStatus;
  note: string;
  author: PersonRef;
  at: string;
}

export interface TaskComment {
  id: number;
  author: PersonRef;
  body: string;
  at: string;
}

export interface TaskImage {
  id: number;
  url: string;
  name: string;
}

/** Tabs of the task detail modal. */
export type TaskDetailTab = 'detail' | 'comments' | 'history' | 'images';

export interface TaskDetailData extends TaskCardData {
  projectName: string;
  batch: BatchVersion;
  createdAt: string;
  createdBy: PersonRef;
  updatedAt: string;
  logs: TaskLogEntry[];
  comments: TaskComment[];
  images: TaskImage[];
}

export interface NewTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string;
  files: File[];
}

export interface MoveTaskInput {
  taskId: number;
  to: TaskStatus;
  note: string;
}

export type BumpKind = 'minor' | 'major';

export interface ReleaseSummary extends BatchVersion {
  id: number;
  label: string;
  openedAt: string;
  closedAt: string;
  taskCount: number;
  isMajor: boolean;
}

export interface ChangelogEntry {
  id: number;
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

/** One line of the activity feed: who did what, to which task or project. */
export interface ActivityEntry {
  id: number;
  actor: PersonRef;
  kind: 'created' | 'moved' | 'completed' | 'commented' | 'bumped';
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
  batch: BatchVersion;
  counts: StatusCounts;
}

export interface NewProjectInput {
  name: string;
  description: string;
}
