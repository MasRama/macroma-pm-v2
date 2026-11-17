import type { Batch, BatchRef, ColumnCounts, Project, ProjectPersonRef, Task, TaskAttachment, TaskComment, TaskLog } from '../contract';
import type { ProjectsServerHost } from './host';
import {
  directMemberIdsByProject,
  directMemberRole,
  emptyCounts,
  type AttachmentRow,
  type BatchRow,
  type CommentRow,
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

export function batchRef(row: BatchRow): BatchRef {
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
    total: columns.backlog + columns.ongoing + columns.revisi + columns.review + columns.done,
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
