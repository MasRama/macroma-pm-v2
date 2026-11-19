import { Hono } from 'hono';
import {
  apiCommentsQuerySchema,
  apiDeletedTasksQuerySchema,
  apiProjectsQuerySchema,
  apiTasksQuerySchema,
  createCommentInputSchema,
  createTaskInputSchema,
  moveTaskInputSchema,
  updateTaskInputSchema,
  TASK_COLUMN_NAMES,
  TASK_COLUMNS,
  type ApiColumnsSuccess,
  type ApiCommentsSuccess,
  type ApiDeletedTasksSuccess,
  type ApiProjectMembersSuccess,
  type ApiProjectsSuccess,
  type ApiProjectSuccess,
  type ApiTasksSuccess,
  type BatchesSuccess,
  type CommentAddedSuccess,
  type ProjectsDone,
  type TaskDetailSuccess,
  type TaskMovedSuccess,
  type TaskSavedSuccess,
} from '../contract';
import { createGuard, jsonInput, newestFirstAfter, pageAfter, pageOf, queryInput } from '../../../shared/security';
import { batchesOf, commentView, membersOf, personRefs, summaries, taskDetailView, taskViews } from './access';
import { projectLoader, taskLoader } from './access-loaders';
import type { ProjectsServerHost } from './host';
import { batchNotFound } from './refusals';
import { findBatch, listProjectsFor, pageComments, pageTaskDeletions, pageTasks, taskCountsByProject } from './repository';
import { addCommentAction, createTaskAction, deleteTaskAction, moveTaskAction, refuseTaskWrite, updateTaskAction } from './task-actions';

/*
 * Projects and tasks in the public API (`/api/v1`). The caller is the account
 * of the request's bearer token, never a session cookie; writes need a
 * `write` token, which the application's token pipeline checks. The same
 * loaders, views and task actions as the browser routes answer, so access,
 * shapes, logs, notifications and live events cannot fork.
 */

function apiGuard(host: ProjectsServerHost) {
  return createGuard((context) => host.apiActor(context));
}

/** Mounted at `/api/v1/projects`. */
export function createProjectsApiRoutes(host: ProjectsServerHost) {
  const guard = apiGuard(host);
  const { projectAccess, current } = projectLoader(host, guard.actor);

  return new Hono()
    .get('/', guard.signedIn, queryInput(apiProjectsQuerySchema), (context) => {
      const actor = guard.actor(context);
      const { workspace_id, ...page } = context.req.valid('query');
      // An account opens few projects: they page in memory, newest first.
      const projects = pageAfter(listProjectsFor(actor.id, host.workspacesOf(actor.id), workspace_id), page, newestFirstAfter, (project) => ({
        at: project.created_at,
        id: project.id,
      }));
      return context.json({
        success: true as const,
        message: 'OK',
        data: { projects: summaries(host, projects.items, actor), next_cursor: projects.nextCursor },
      } satisfies ApiProjectsSuccess);
    })
    .get('/:id', guard.signedIn, projectAccess('member'), (context) => {
      const project = current(context);
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          project: summaries(host, [project], guard.actor(context))[0],
          active_batch: batchesOf(project.id).find((batch) => batch.is_active) ?? null,
        },
      } satisfies ApiProjectSuccess);
    })
    .get('/:id/columns', guard.signedIn, projectAccess('member'), (context) => {
      const project = current(context);
      const counts = taskCountsByProject([project.id]).get(project.id);
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          columns: TASK_COLUMNS.map((column, position) => ({
            id: column,
            name: TASK_COLUMN_NAMES[column],
            position,
            task_count: counts?.[column] ?? 0,
          })),
        },
      } satisfies ApiColumnsSuccess);
    })
    .get('/:id/batches', guard.signedIn, projectAccess('member'), (context) => {
      return context.json({
        success: true as const,
        message: 'OK',
        data: { batches: batchesOf(current(context).id) },
      } satisfies BatchesSuccess);
    })
    .get('/:id/members', guard.signedIn, projectAccess('member'), (context) => {
      return context.json({
        success: true as const,
        message: 'OK',
        data: { members: membersOf(host, current(context)) },
      } satisfies ApiProjectMembersSuccess);
    })
    .get('/:id/tasks', guard.signedIn, projectAccess('member'), queryInput(apiTasksQuerySchema), (context) => {
      const project = current(context);
      const query = context.req.valid('query');
      if (query.batch_id !== undefined) {
        const batch = findBatch(query.batch_id);
        if (!batch || batch.project_id !== project.id) return batchNotFound(context);
      }
      const rows = pageTasks(
        project.id,
        {
          batchId: query.batch_id,
          columnId: query.column_id,
          assigneeId: query.assignee_id,
          updatedSince: query.updated_since,
          after: query.cursor,
        },
        query.limit,
      );
      const page = pageOf(rows, query.limit, (task) => ({ at: task.updated_at, id: task.id }));
      return context.json({
        success: true as const,
        message: 'OK',
        data: { tasks: taskViews(host, page.items), next_cursor: page.nextCursor },
      } satisfies ApiTasksSuccess);
    })
    .get('/:id/tasks/deleted', guard.signedIn, projectAccess('member'), queryInput(apiDeletedTasksQuerySchema), (context) => {
      const { since, cursor, limit } = context.req.valid('query');
      const rows = pageTaskDeletions(current(context).id, { since, after: cursor }, limit);
      const page = pageOf(rows, limit, (row) => ({ at: row.deleted_at, id: row.task_id }));
      return context.json({
        success: true as const,
        message: 'OK',
        data: { deleted: page.items.map((row) => ({ id: row.task_id, deleted_at: row.deleted_at })), next_cursor: page.nextCursor },
      } satisfies ApiDeletedTasksSuccess);
    })
    .post('/:id/tasks', guard.signedIn, projectAccess('member'), jsonInput(createTaskInputSchema), (context) => {
      const created = createTaskAction(host, guard.actor(context), current(context), context.req.valid('json'));
      if (created.status !== 'ok') return refuseTaskWrite(context, created);
      return context.json({ success: true as const, message: 'Task created', data: { task: created.task } } satisfies TaskSavedSuccess, 201);
    });
}

/** Mounted at `/api/v1/tasks`. */
export function createTasksApiRoutes(host: ProjectsServerHost) {
  const guard = apiGuard(host);
  const { taskAccess, current } = taskLoader(host, guard.actor);

  return new Hono()
    .get('/:id', guard.signedIn, taskAccess('member'), (context) => {
      const { task, project } = current(context);
      return context.json({
        success: true as const,
        message: 'OK',
        data: { task: taskDetailView(host, task, project) },
      } satisfies TaskDetailSuccess);
    })
    .get('/:id/comments', guard.signedIn, taskAccess('member'), queryInput(apiCommentsQuerySchema), (context) => {
      const { cursor, limit } = context.req.valid('query');
      const page = pageOf(pageComments(current(context).task.id, cursor, limit), limit, (comment) => ({
        at: comment.created_at,
        id: comment.id,
      }));
      const people = personRefs(
        host,
        page.items.map((comment) => comment.user_id),
      );
      return context.json({
        success: true as const,
        message: 'OK',
        data: { comments: page.items.map((comment) => commentView(comment, people)), next_cursor: page.nextCursor },
      } satisfies ApiCommentsSuccess);
    })
    .patch('/:id', guard.signedIn, taskAccess('member'), jsonInput(updateTaskInputSchema), (context) => {
      const updated = updateTaskAction(host, guard.actor(context), current(context), context.req.valid('json'));
      if (updated.status !== 'ok') return refuseTaskWrite(context, updated);
      return context.json({ success: true as const, message: 'Task updated', data: { task: updated.task } } satisfies TaskSavedSuccess);
    })
    .patch('/:id/move', guard.signedIn, taskAccess('member'), jsonInput(moveTaskInputSchema), (context) => {
      const moved = moveTaskAction(host, guard.actor(context), current(context), context.req.valid('json'));
      if (moved.status !== 'ok') return refuseTaskWrite(context, moved);
      return context.json({ success: true as const, message: 'Task moved', data: { task: moved.task, log: moved.log } } satisfies TaskMovedSuccess);
    })
    .delete('/:id', guard.signedIn, taskAccess('owner'), async (context) => {
      await deleteTaskAction(host, guard.actor(context), current(context));
      return context.json({ success: true as const, message: 'Task deleted' } satisfies ProjectsDone);
    })
    .post('/:id/comments', guard.signedIn, taskAccess('member'), jsonInput(createCommentInputSchema), (context) => {
      const { comment } = addCommentAction(host, guard.actor(context), current(context), context.req.valid('json'));
      return context.json({ success: true as const, message: 'Comment added', data: { comment } } satisfies CommentAddedSuccess, 201);
    });
}
