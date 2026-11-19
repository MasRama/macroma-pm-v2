import type { Context } from 'hono';
import {
  STALE_REVISION,
  type CreateCommentInput,
  type CreateTaskInput,
  type MoveTaskInput,
  type Project,
  type Task,
  type TaskComment,
  type TaskLog,
  type UpdateTaskInput,
} from '../contract';
import { getDatabase } from '../../../shared/database';
import { assignable, commentView, logView, personRefs, projectAudience, taskView, taskViews } from './access';
import { removeStoredImages } from './attachments';
import type { ProjectsServerHost } from './host';
import { announceBoardChange } from './live';
import { noticeTaskMoved } from './notices';
import { assigneeRefused, batchNotFound, refuse, taskNotFound } from './refusals';
import { activeBatches, createComment, createTask, deleteTask, findBatch, moveTask, updateTask, type TaskRow } from './repository';

/*
 * The task writes, shared by the browser routes and the public API so both
 * write, log, notify and announce alike. Each takes a caller its route
 * already admitted to the project and answers with what happened; the route
 * turns a refusal into its answer with `refuseTaskWrite`.
 */

type Actor = { id: string; name: string; email: string };

export type TaskWriteRefusal =
  | { status: 'assignee_refused' }
  | { status: 'batch_not_found' }
  | { status: 'task_not_found' }
  | { status: 'stale'; current: Task }
  | { status: 'already_in_column' };

/** The answer to a refused task write, the same through every route. */
export function refuseTaskWrite(context: Context, refusal: TaskWriteRefusal) {
  switch (refusal.status) {
    case 'assignee_refused':
      return assigneeRefused(context);
    case 'batch_not_found':
      return batchNotFound(context);
    case 'task_not_found':
      return taskNotFound(context);
    case 'already_in_column':
      return refuse(context, 409, 'TASK_ALREADY_IN_COLUMN', 'The task is already in this column');
    case 'stale':
      return context.json(
        {
          success: false as const,
          message: 'This task changed elsewhere since you opened it',
          code: STALE_REVISION,
          current: refusal.current,
        },
        409,
      );
  }
}

export function createTaskAction(
  host: ProjectsServerHost,
  actor: Actor,
  project: Project,
  input: CreateTaskInput,
): { status: 'ok'; task: Task } | TaskWriteRefusal {
  const assigneeId = input.assignee_id ?? null;
  if (assigneeId !== null && !assignable(host, project, assigneeId)) return { status: 'assignee_refused' };
  let batchId: string | null;
  if (input.batch_id) {
    const batch = findBatch(input.batch_id);
    if (!batch || batch.project_id !== project.id) return { status: 'batch_not_found' };
    batchId = batch.id;
  } else {
    batchId = activeBatches([project.id]).get(project.id)?.id ?? null;
  }
  const task = createTask({
    projectId: project.id,
    batchId,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? 'medium',
    assigneeId,
    actorId: actor.id,
  });
  announceBoardChange(projectAudience(host, project));
  return { status: 'ok', task: taskViews(host, [task])[0] };
}

export function updateTaskAction(
  host: ProjectsServerHost,
  actor: Actor,
  { task, project }: { task: TaskRow; project: Project },
  input: UpdateTaskInput,
): { status: 'ok'; task: Task } | TaskWriteRefusal {
  const { revision, assignee_id, ...patch } = input;
  if (assignee_id && assignee_id !== task.assignee_id && !assignable(host, project, assignee_id)) return { status: 'assignee_refused' };
  const update = updateTask(task.id, { ...patch, assigneeId: assignee_id }, revision, actor.id);
  if (update.status === 'missing') return { status: 'task_not_found' };
  if (update.status === 'stale') return { status: 'stale', current: taskViews(host, [update.task])[0] };
  announceBoardChange(projectAudience(host, project));
  return { status: 'ok', task: taskViews(host, [update.task])[0] };
}

/** Moves the task and notifies its assignee and creator in one transaction. */
export function moveTaskAction(
  host: ProjectsServerHost,
  actor: Actor,
  { task, project }: { task: TaskRow; project: Project },
  input: MoveTaskInput,
): { status: 'ok'; task: Task; log: TaskLog } | TaskWriteRefusal {
  if (input.column_id === task.column_id) return { status: 'already_in_column' };
  const moved = getDatabase().transaction(() => {
    const result = moveTask(task, { column: input.column_id, note: input.note ?? '', sortOrder: input.sort_order }, actor.id);
    noticeTaskMoved(host, project, task, result.log, actor);
    return result;
  })();
  const people = personRefs(host, [moved.task.assignee_id, actor.id]);
  announceBoardChange(projectAudience(host, project));
  return { status: 'ok', task: taskView(moved.task, people), log: logView(moved.log, people) };
}

/** Deletes the task, then its stored images once the rows are gone. */
export async function deleteTaskAction(
  host: ProjectsServerHost,
  actor: Actor,
  { task, project }: { task: TaskRow; project: Project },
): Promise<{ status: 'ok' }> {
  const images = deleteTask(task, actor.id);
  announceBoardChange(projectAudience(host, project));
  await removeStoredImages(host, images);
  return { status: 'ok' };
}

export function addCommentAction(
  host: ProjectsServerHost,
  actor: Actor,
  { task, project }: { task: TaskRow; project: Project },
  input: CreateCommentInput,
): { status: 'ok'; comment: TaskComment } {
  const comment = createComment({ taskId: task.id, userId: actor.id, content: input.content });
  announceBoardChange(projectAudience(host, project));
  return { status: 'ok', comment: commentView(comment, personRefs(host, [actor.id])) };
}
