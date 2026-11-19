import type {
  ActiveRelease,
  Batch,
  BatchRef,
  ChangelogEntry,
  ColumnCounts,
  Project,
  ProjectMember,
  ProjectPersonRef,
  ProjectSummary,
  Release,
  ReleaseBatch,
  ReleaseStats,
  Task,
  TaskAttachment,
  TaskComment,
  TaskDetail,
  TaskLog,
  UpcomingRelease,
} from '../contract';
import type { ProjectsServerHost } from './host';
import {
  activeBatches,
  countsByBatch,
  directMemberIdsByProject,
  directMemberRole,
  directMembers,
  emptyCounts,
  findBatch,
  listBatches,
  listLogs,
  taskCountsByProject,
  type AttachmentRow,
  type BatchRow,
  type ChangelogRow,
  type CommentRow,
  type ReleaseRow,
  type TaskLogRow,
  type TaskRow,
} from './repository';

/** Project access, as in V1: a direct member of the project, or a member of its workspace. */
export function canOpenProject(host: ProjectsServerHost, project: Project, userId: string): boolean {
  if (directMemberRole(project.id, userId)) return true;
  return project.workspace_id !== null && host.isWorkspaceMember(project.workspace_id, userId);
}

/** Every account that can open each project; one query for the direct members, one host call per workspace. */
export function projectAudiences(host: ProjectsServerHost, projects: readonly Project[]): Map<string, Set<string>> {
  const direct = directMemberIdsByProject(projects.map((project) => project.id));
  const workspaceMembers = new Map<string, string[]>();
  const audiences = new Map<string, Set<string>>();
  for (const project of projects) {
    const audience = new Set(direct.get(project.id) ?? []);
    if (project.workspace_id) {
      let members = workspaceMembers.get(project.workspace_id);
      if (!members) {
        members = host.workspaceMemberIds(project.workspace_id);
        workspaceMembers.set(project.workspace_id, members);
      }
      for (const member of members) audience.add(member);
    }
    audiences.set(project.id, audience);
  }
  return audiences;
}

export function projectAudience(host: ProjectsServerHost, project: Project): Set<string> {
  return projectAudiences(host, [project]).get(project.id) ?? new Set();
}

export function personRefs(host: ProjectsServerHost, userIds: Iterable<string | null>): Map<string, ProjectPersonRef> {
  const ids = [...new Set([...userIds].filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  return new Map(host.findAccountsByIds(ids).map((person) => [person.id, { id: person.id, name: person.name, avatar: person.avatar }]));
}

export function batchRef(row: Pick<BatchRow, 'id' | 'major' | 'minor' | 'label'>): BatchRef {
  return { id: row.id, major: row.major, minor: row.minor, label: row.label };
}

export function batchView(row: BatchRow, counts: ColumnCounts | undefined): Batch {
  const columns = counts ?? emptyCounts();
  return {
    ...batchRef(row),
    project_id: row.project_id,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    counts: columns,
    total: countsTotal(columns),
  };
}

function countsTotal(columns: ColumnCounts): number {
  return columns.backlog + columns.ongoing + columns.revisi + columns.review + columns.done;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function majorBump(row: ReleaseRow): boolean {
  return row.previous_major !== null && row.previous_major !== row.major;
}

/** One batch on the releases view; only a released batch that is no longer active is closed. */
export function releaseBatchView(row: ReleaseRow): ReleaseBatch {
  return {
    ...batchRef(row),
    created_at: row.created_at,
    opened_at: row.activated_at,
    closed_at: row.is_active === 1 || row.activated_at === null ? null : row.next_activated_at,
    task_count: row.task_count,
    major_bump: majorBump(row),
    is_active: row.is_active === 1,
  };
}

/** The released batches that are no longer active, in the rows' order. */
export function closedReleases(rows: readonly ReleaseRow[]): Release[] {
  return rows.flatMap((row) =>
    row.is_active !== 1 && row.activated_at !== null && row.next_activated_at !== null
      ? [
          {
            ...batchRef(row),
            opened_at: row.activated_at,
            closed_at: row.next_activated_at,
            task_count: row.task_count,
            major_bump: majorBump(row),
          },
        ]
      : [],
  );
}

/** The planned batches, never activated, in the rows' order. */
export function upcomingReleases(rows: readonly ReleaseRow[]): UpcomingRelease[] {
  return rows.flatMap((row) =>
    row.activated_at === null && row.is_active !== 1
      ? [{ ...batchRef(row), created_at: row.created_at, task_count: row.task_count, major_bump: majorBump(row) }]
      : [],
  );
}

export function activeReleaseView(row: ReleaseRow, counts: ColumnCounts | undefined): ActiveRelease {
  const columns = counts ?? emptyCounts();
  const total = countsTotal(columns);
  return {
    ...batchRef(row),
    opened_at: row.activated_at ?? row.created_at,
    counts: columns,
    total,
    done: columns.done,
    progress: total === 0 ? 0 : Math.round((columns.done * 100) / total),
  };
}

export function releaseStatsView(batch: ReleaseBatch, revisiTasks: number): ReleaseStats {
  return {
    task_count: batch.task_count,
    duration_days:
      batch.opened_at === null || batch.closed_at === null ? null : Math.ceil((batch.closed_at - batch.opened_at) / DAY_MS),
    revisi_task_count: revisiTasks,
  };
}

export function changelogView(row: ChangelogRow, people: Map<string, ProjectPersonRef>): ChangelogEntry {
  return {
    task_id: row.id,
    title: row.title,
    priority: row.priority,
    version: { major: row.version_major, minor: row.version_minor, patch: row.version_patch },
    assignee: row.assignee_id ? (people.get(row.assignee_id) ?? null) : null,
    column_id: row.column_id,
  };
}

export function taskView(row: TaskRow, people: Map<string, ProjectPersonRef>): Task {
  return {
    id: row.id,
    project_id: row.project_id,
    batch_id: row.batch_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    assignee: row.assignee_id ? (people.get(row.assignee_id) ?? null) : null,
    column_id: row.column_id,
    sort_order: row.sort_order,
    version: { major: row.version_major, minor: row.version_minor, patch: row.version_patch },
    revision: row.revision,
    revisi_count: row.revisi_count,
    comment_count: row.comment_count,
    attachment_count: row.attachment_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Tasks with their assignees, from one account lookup. */
export function taskViews(host: ProjectsServerHost, rows: readonly TaskRow[]): Task[] {
  const people = personRefs(
    host,
    rows.map((row) => row.assignee_id),
  );
  return rows.map((row) => taskView(row, people));
}

export function logView(row: TaskLogRow, people: Map<string, ProjectPersonRef>): TaskLog {
  return {
    id: row.id,
    version: row.version,
    column_from: row.column_from,
    column_to: row.column_to,
    note: row.note,
    user: row.created_by ? (people.get(row.created_by) ?? null) : null,
    created_at: row.created_at,
  };
}

export function commentView(row: CommentRow, people: Map<string, ProjectPersonRef>): TaskComment {
  return {
    id: row.id,
    task_id: row.task_id,
    content: row.content,
    user: row.user_id ? (people.get(row.user_id) ?? null) : null,
    created_at: row.created_at,
  };
}

/** Where an attachment's image is served, to accounts that can open the project. */
export function attachmentUrl(row: Pick<AttachmentRow, 'id' | 'task_id'>): string {
  return `/api/tasks/${row.task_id}/attachments/${row.id}/file`;
}

export function attachmentView(row: AttachmentRow, people: Map<string, ProjectPersonRef>): TaskAttachment {
  return {
    id: row.id,
    task_id: row.task_id,
    name: row.name,
    mime_type: row.mime_type,
    size: row.size,
    url: attachmentUrl(row),
    uploaded_by: row.uploaded_by ? (people.get(row.uploaded_by) ?? null) : null,
    created_at: row.created_at,
  };
}

/** Whether the account may be assigned tasks of the project. */
export function assignable(host: ProjectsServerHost, project: Project, userId: string): boolean {
  return host.findAccountsByIds([userId]).length > 0 && canOpenProject(host, project, userId);
}

export function summaries(host: ProjectsServerHost, projects: readonly Project[], actor: { id: string }): ProjectSummary[] {
  const ids = projects.map((project) => project.id);
  const active = activeBatches(ids);
  const counts = taskCountsByProject(ids);
  const audiences = projectAudiences(host, projects);
  return projects.map((project) => {
    const batch = active.get(project.id);
    return {
      ...project,
      role: project.owner_id === actor.id ? 'owner' : 'member',
      active_batch: batch ? batchRef(batch) : null,
      task_counts: counts.get(project.id) ?? { backlog: 0, ongoing: 0, revisi: 0, review: 0, done: 0 },
      member_count: audiences.get(project.id)?.size ?? 0,
    };
  });
}

/** Direct members first, in joining order, then the accounts that reach the project through its workspace. */
export function membersOf(host: ProjectsServerHost, project: Project): ProjectMember[] {
  const direct = directMembers(project.id);
  const directIds = new Set(direct.map((member) => member.user_id));
  const viaWorkspace = project.workspace_id ? host.workspaceMemberIds(project.workspace_id).filter((id) => !directIds.has(id)) : [];
  const accounts = new Map(host.findAccountsByIds([...directIds, ...viaWorkspace]).map((person) => [person.id, person]));
  const members: ProjectMember[] = [];
  for (const member of direct) {
    const user = accounts.get(member.user_id);
    if (user) members.push({ user, role: member.role, source: 'project' });
  }
  for (const userId of viaWorkspace) {
    const user = accounts.get(userId);
    if (user) members.push({ user, role: 'member', source: 'workspace' });
  }
  return members;
}

/** The project's batches with their task counts, newest version first. */
export function batchesOf(projectId: string): Batch[] {
  const counts = countsByBatch(projectId);
  return listBatches(projectId).map((row) => batchView(row, counts.get(row.id)));
}

/** A task with its project, batch, creator and every version it went through. */
export function taskDetailView(host: ProjectsServerHost, task: TaskRow, project: Project): TaskDetail {
  const logs = listLogs(task.id);
  const creatorId = logs[0]?.created_by ?? null;
  const people = personRefs(host, [task.assignee_id, creatorId, ...logs.map((log) => log.created_by)]);
  const batch = task.batch_id ? findBatch(task.batch_id) : undefined;
  return {
    ...taskView(task, people),
    project: { id: project.id, name: project.name },
    batch: batch ? batchRef(batch) : null,
    created_by: creatorId ? (people.get(creatorId) ?? null) : null,
    logs: logs.map((log) => logView(log, people)),
  };
}
