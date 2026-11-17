import { PROJECTS_NOTIFICATION_TYPES, type Project } from '../contract';
import { canOpenProject } from './access';
import type { ProjectsServerHost } from './host';
import { listLogs, type TaskLogRow, type TaskRow } from './repository';

/**
 * Tells the task's assignee and creator (who wrote its first log) that it
 * moved: one notification each, never to the account that moved it, and only
 * to accounts that still exist and can open the project. Called inside the
 * move's transaction, with the task as it was before the move.
 */
export function noticeTaskMoved(
  host: ProjectsServerHost,
  project: Project,
  task: TaskRow,
  log: TaskLogRow,
  actor: { id: string; name: string; email: string },
): void {
  const creatorId = listLogs(task.id)[0]?.created_by ?? null;
  const candidates = [...new Set([task.assignee_id, creatorId])].filter((id): id is string => id !== null && id !== actor.id);
  if (candidates.length === 0) return;
  const recipients = host.findAccountsByIds(candidates).filter((account) => canOpenProject(host, project, account.id));
  for (const recipient of recipients) {
    host.notify(recipient.id, PROJECTS_NOTIFICATION_TYPES.taskMoved, {
      project_id: project.id,
      project_name: project.name,
      task_id: task.id,
      task_title: task.title,
      version: log.version,
      column_from: task.column_id,
      column_to: log.column_to,
      actor_id: actor.id,
      actor_name: actor.name || actor.email,
    });
  }
}
