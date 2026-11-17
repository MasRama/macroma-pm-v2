import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import {
  addProjectMemberInputSchema,
  boardQuerySchema,
  createBatchInputSchema,
  createCommentInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  listProjectsQuerySchema,
  moveTaskInputSchema,
  STALE_REVISION,
  updateProjectInputSchema,
  updateTaskInputSchema,
  uploadAttachmentsQuerySchema,
  TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  TASK_ATTACHMENT_MAX_FILES,
  type AttachmentsSuccess,
  type AttachmentsUploadedSuccess,
  type BatchesSuccess,
  type BatchSavedSuccess,
  type CommentAddedSuccess,
  type CommentsSuccess,
  type DashboardSuccess,
  type MemberAddedSuccess,
  type Project,
  type ProjectActivitySuccess,
  type ProjectDetailSuccess,
  type ProjectMember,
  type ProjectsDone,
  type ProjectSavedSuccess,
  type ProjectsRefusalCode,
  type ProjectsSuccess,
  type ProjectSummary,
  type ReleaseDetailSuccess,
  type ReleasesSuccess,
  type TaskDetailSuccess,
  type TaskLogsSuccess,
  type TaskMovedSuccess,
  type TasksSuccess,
  type TaskSavedSuccess,
} from '../contract';
import { getDatabase } from '../../../shared/database';
import { createGuard, forbidden, jsonInput, queryInput, type RoutePolicy } from '../../../shared/security';
import {
  activeReleaseView,
  attachmentView,
  batchRef,
  batchView,
  canOpenProject,
  changelogView,
  commentView,
  logView,
  personRefs,
  projectAudience,
  projectAudiences,
  closedReleases,
  releaseBatchView,
  releaseStatsView,
  upcomingReleases,
  taskView,
  taskViews,
} from './access';
import { removeStoredImages, storeImages, uploadedFiles } from './attachments';
import { dashboardData } from './dashboard';
import type { ProjectsServerHost } from './host';
import { announceBoardChange, announceProjectChange, projectsBoardChangedTopic, projectsChangedTopic } from './live';
import {
  activateBatch,
  activeBatches,
  addAttachments,
  addProjectMember,
  changelogRows,
  contributorCounts,
  countsByBatch,
  createBatch,
  createComment,
  createProject,
  createTask,
  deleteAttachment,
  deleteComment,
  deleteProject,
  deleteTask,
  directMemberRole,
  directMembers,
  findAttachment,
  findBatch,
  findComment,
  findProject,
  findTask,
  listActivity,
  listAttachments,
  listBatches,
  listComments,
  listLogs,
  listProjectsFor,
  listReleases,
  listTasks,
  moveTask,
  removeProjectMember,
  revisiTaskCount,
  taskCountsByProject,
  unassignTasks,
  updateProject,
  updateTask,
  type BatchRow,
  type TaskRow,
} from './repository';

type Actor = { id: string; name: string; email: string };

function refuse<C extends ProjectsRefusalCode>(context: Context, status: 404 | 409, code: C, message: string) {
  return context.json({ success: false as const, message, code }, status);
}

function assigneeRefused(context: Context) {
  return context.json(
    {
      success: false as const,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR' as const,
      errors: { assignee_id: ['The assignee must be able to open the project'] },
    },
    422,
  );
}

const projectNotFound = (context: Context) => refuse(context, 404, 'PROJECT_NOT_FOUND', 'Project not found');
const batchNotFound = (context: Context) => refuse(context, 404, 'BATCH_NOT_FOUND', 'Batch not found');
const taskNotFound = (context: Context) => refuse(context, 404, 'TASK_NOT_FOUND', 'Task not found');
const commentNotFound = (context: Context) => refuse(context, 404, 'COMMENT_NOT_FOUND', 'Comment not found');
const attachmentNotFound = (context: Context) => refuse(context, 404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');

function guardFor(host: ProjectsServerHost) {
  return createGuard((context) => host.resolveActor(getCookie(context, host.sessionCookieName)));
}

/** Whether the account may be assigned tasks of the project. */
function assignable(host: ProjectsServerHost, project: Project, userId: string): boolean {
  return host.findAccountsByIds([userId]).length > 0 && canOpenProject(host, project, userId);
}

function summaries(host: ProjectsServerHost, projects: readonly Project[], actor: Actor): ProjectSummary[] {
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
function membersOf(host: ProjectsServerHost, project: Project): ProjectMember[] {
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

export function createProjectRoutes(host: ProjectsServerHost) {
  // Declared with the routes, so the application knows the topics once composed.
  projectsChangedTopic();
  projectsBoardChangedTopic();
  const guard = guardFor(host);

  /**
   * Loads the `:id` project ahead of input validation: 404 when it does not
   * exist, 403 unless the caller can open it (or owns it, for `owner`).
   */
  const loaded = new WeakMap<Context, Project>();
  const projectAccess =
    (need: 'member' | 'owner'): MiddlewareHandler =>
    async (context, next) => {
      const actor = guard.actor(context);
      const project = findProject(context.req.param('id') ?? '');
      if (!project) return projectNotFound(context);
      if (!canOpenProject(host, project, actor.id)) return forbidden(context, 'You cannot open this project');
      if (need === 'owner' && project.owner_id !== actor.id) return forbidden(context, 'Only the project owner can do this');
      loaded.set(context, project);
      await next();
    };
  const current = (context: Context): Project => {
    const project = loaded.get(context);
    if (!project) throw new Error('Route reads the project without loading it');
    return project;
  };

  function batchesOf(projectId: string) {
    const counts = countsByBatch(projectId);
    return listBatches(projectId).map((row) => batchView(row, counts.get(row.id)));
  }

  function savedBatch(row: BatchRow) {
    return batchView(row, countsByBatch(row.project_id).get(row.id));
  }

  return new Hono()
    .get('/', guard.signedIn, queryInput(listProjectsQuerySchema), (context) => {
      const actor = guard.actor(context);
      const { workspace_id } = context.req.valid('query');
      const projects = listProjectsFor(actor.id, host.workspacesOf(actor.id), workspace_id);
      return context.json({
        success: true as const,
        message: 'OK',
        data: { projects: summaries(host, projects, actor) },
      } satisfies ProjectsSuccess);
    })
    .post('/', guard.signedIn, jsonInput(createProjectInputSchema), (context) => {
      const actor = guard.actor(context);
      const input = context.req.valid('json');
      const workspaceId = input.workspace_id ?? null;
      if (workspaceId !== null && !host.isWorkspaceMember(workspaceId, actor.id)) {
        return forbidden(context, 'You are not a member of this workspace');
      }
      const project = createProject({ name: input.name, description: input.description ?? null, ownerId: actor.id, workspaceId });
      announceProjectChange(projectAudience(host, project));
      return context.json(
        { success: true as const, message: 'Project created', data: { project } } satisfies ProjectSavedSuccess,
        201,
      );
    })
    .get('/:id', guard.signedIn, projectAccess('member'), (context) => {
      const actor = guard.actor(context);
      const project = current(context);
      const batches = batchesOf(project.id);
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          project: summaries(host, [project], actor)[0],
          batches,
          active_batch: batches.find((batch) => batch.is_active) ?? null,
          members: membersOf(host, project),
        },
      } satisfies ProjectDetailSuccess);
    })
    .patch('/:id', guard.signedIn, projectAccess('owner'), jsonInput(updateProjectInputSchema), (context) => {
      const project = current(context);
      const { revision, ...patch } = context.req.valid('json');
      const update = updateProject(project.id, patch, revision);
      if (update.status === 'missing') return projectNotFound(context);
      if (update.status === 'stale') {
        return context.json(
          {
            success: false as const,
            message: 'This project changed elsewhere since you opened it',
            code: STALE_REVISION,
            current: update.project,
          },
          409,
        );
      }
      announceProjectChange(projectAudience(host, project));
      return context.json({
        success: true as const,
        message: 'Project updated',
        data: { project: update.project },
      } satisfies ProjectSavedSuccess);
    })
    .delete('/:id', guard.signedIn, projectAccess('owner'), async (context) => {
      const project = current(context);
      const audience = projectAudience(host, project);
      const images = deleteProject(project.id);
      announceProjectChange(audience);
      await removeStoredImages(host, images);
      return context.json({ success: true as const, message: 'Project deleted' } satisfies ProjectsDone);
    })
    .post('/:id/members', guard.signedIn, projectAccess('owner'), jsonInput(addProjectMemberInputSchema), (context) => {
      const project = current(context);
      const account = host.findAccountByEmail(context.req.valid('json').email);
      if (!account) return refuse(context, 404, 'ACCOUNT_NOT_FOUND', 'No account uses this email');
      if (directMemberRole(project.id, account.id)) {
        return refuse(context, 409, 'ALREADY_MEMBER', 'This account is already a member of the project');
      }
      addProjectMember(project.id, account.id);
      announceProjectChange(projectAudience(host, project));
      return context.json(
        {
          success: true as const,
          message: 'Member added',
          data: { member: { user: account, role: 'member', source: 'project' } },
        } satisfies MemberAddedSuccess,
        201,
      );
    })
    .delete('/:id/members/:userId', guard.signedIn, projectAccess('owner'), (context) => {
      const project = current(context);
      const userId = context.req.param('userId');
      if (userId === project.owner_id) {
        return refuse(context, 409, 'OWNER_CANNOT_BE_REMOVED', 'The owner cannot be removed from the project');
      }
      const audience = projectAudience(host, project);
      // A member who can no longer open the project (no workspace way in) comes off its tasks.
      const removed = getDatabase().transaction(() => {
        if (!removeProjectMember(project.id, userId)) return undefined;
        return { unassigned: !canOpenProject(host, project, userId) && unassignTasks(project.id, [userId]) };
      })();
      if (!removed) return refuse(context, 404, 'MEMBER_NOT_FOUND', 'This account is not a member of the project');
      announceProjectChange(audience);
      if (removed.unassigned) announceBoardChange(projectAudience(host, project));
      return context.json({ success: true as const, message: 'Member removed' } satisfies ProjectsDone);
    })
    .get('/:id/activity', guard.signedIn, projectAccess('member'), (context) => {
      const rows = listActivity(current(context).id);
      const actors = personRefs(
        host,
        rows.map((row) => row.actor_id),
      );
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          activity: rows.map((row) => ({
            id: row.id,
            event_type: row.event_type,
            description: row.description,
            actor: row.actor_id ? (actors.get(row.actor_id) ?? null) : null,
            task_id: row.task_id,
            batch_id: row.batch_id,
            task_title: row.task_title,
            batch_version: row.batch_version,
            meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
            created_at: row.created_at,
          })),
        },
      } satisfies ProjectActivitySuccess);
    })
    .get('/:id/batches', guard.signedIn, projectAccess('member'), (context) => {
      return context.json({
        success: true as const,
        message: 'OK',
        data: { batches: batchesOf(current(context).id) },
      } satisfies BatchesSuccess);
    })
    .post('/:id/batches', guard.signedIn, projectAccess('member'), jsonInput(createBatchInputSchema), (context) => {
      const actor = guard.actor(context);
      const project = current(context);
      const input = context.req.valid('json');
      if (input.activate && project.owner_id !== actor.id) return forbidden(context, 'Only the project owner can activate a batch');
      const batch = createBatch(
        project.id,
        { label: input.label ?? null, bumpMajor: input.bump_major === true, activate: input.activate === true },
        actor.id,
      );
      announceProjectChange(projectAudience(host, project));
      return context.json(
        { success: true as const, message: 'Batch created', data: { batch: savedBatch(batch) } } satisfies BatchSavedSuccess,
        201,
      );
    })
    .patch('/:id/batches/:batchId/activate', guard.signedIn, projectAccess('owner'), (context) => {
      const actor = guard.actor(context);
      const project = current(context);
      const batch = findBatch(context.req.param('batchId'));
      if (!batch || batch.project_id !== project.id) return batchNotFound(context);
      const activated = batch.is_active === 1 ? batch : activateBatch(batch, actor.id);
      if (activated !== batch) announceProjectChange(projectAudience(host, project));
      return context.json({
        success: true as const,
        message: 'Batch activated',
        data: { batch: savedBatch(activated) },
      } satisfies BatchSavedSuccess);
    })
    .get('/:id/releases', guard.signedIn, projectAccess('member'), (context) => {
      const project = current(context);
      const releases = listReleases(project.id);
      const active = releases.find((row) => row.is_active === 1);
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          active: active ? activeReleaseView(active, countsByBatch(project.id).get(active.id)) : null,
          closed: closedReleases(releases),
          upcoming: upcomingReleases(releases).reverse(),
        },
      } satisfies ReleasesSuccess);
    })
    .get('/:id/releases/:batchId', guard.signedIn, projectAccess('member'), (context) => {
      const project = current(context);
      const batchId = context.req.param('batchId');
      const row = listReleases(project.id).find((release) => release.id === batchId);
      if (!row) return batchNotFound(context);
      const release = releaseBatchView(row);
      const changelog = changelogRows(row.id);
      const contributions = contributorCounts(row.id);
      // One account lookup for the changelog's assignees and the contributors.
      const ids = new Set([...changelog.flatMap((entry) => entry.assignee_id ?? []), ...contributions.map((entry) => entry.user_id)]);
      const accounts = new Map(host.findAccountsByIds([...ids]).map((account) => [account.id, account]));
      const people = new Map(
        [...accounts.values()].map((account) => [account.id, { id: account.id, name: account.name, avatar: account.avatar }]),
      );
      const contributors = contributions
        .flatMap(({ user_id, task_count }) => {
          const account = accounts.get(user_id);
          if (!account) return [];
          return [{ user: { id: account.id, name: account.name, email: account.email, avatar: account.avatar }, task_count }];
        })
        .sort(
          (left, right) =>
            right.task_count - left.task_count || left.user.name.localeCompare(right.user.name) || left.user.id.localeCompare(right.user.id),
        );
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          batch: release,
          stats: releaseStatsView(release, revisiTaskCount(row.id)),
          changelog: changelog.map((entry) => changelogView(entry, people)),
          contributors,
        },
      } satisfies ReleaseDetailSuccess);
    })
    .get('/:id/tasks', guard.signedIn, projectAccess('member'), queryInput(boardQuerySchema), (context) => {
      const project = current(context);
      const { batch_id } = context.req.valid('query');
      if (batch_id !== undefined) {
        const batch = findBatch(batch_id);
        if (!batch || batch.project_id !== project.id) return batchNotFound(context);
      }
      return context.json({
        success: true as const,
        message: 'OK',
        data: { tasks: taskViews(host, listTasks(project.id, batch_id)) },
      } satisfies TasksSuccess);
    })
    .post('/:id/tasks', guard.signedIn, projectAccess('member'), jsonInput(createTaskInputSchema), (context) => {
      const actor = guard.actor(context);
      const project = current(context);
      const input = context.req.valid('json');
      const assigneeId = input.assignee_id ?? null;
      if (assigneeId !== null && !assignable(host, project, assigneeId)) return assigneeRefused(context);
      let batchId: string | null;
      if (input.batch_id) {
        const batch = findBatch(input.batch_id);
        if (!batch || batch.project_id !== project.id) return batchNotFound(context);
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
      return context.json(
        { success: true as const, message: 'Task created', data: { task: taskViews(host, [task])[0] } } satisfies TaskSavedSuccess,
        201,
      );
    });
}

export function createTaskRoutes(host: ProjectsServerHost) {
  const guard = guardFor(host);

  /**
   * Loads the `:id` task and its project ahead of input validation: 404 when
   * the task does not exist, 403 unless the caller can open its project (or
   * owns it, for `owner`).
   */
  const loaded = new WeakMap<Context, { task: TaskRow; project: Project }>();
  const taskAccess =
    (need: 'member' | 'owner'): MiddlewareHandler =>
    async (context, next) => {
      const actor = guard.actor(context);
      const task = findTask(context.req.param('id') ?? '');
      const project = task ? findProject(task.project_id) : undefined;
      if (!task || !project) return taskNotFound(context);
      if (!canOpenProject(host, project, actor.id)) return forbidden(context, 'You cannot open this project');
      if (need === 'owner' && project.owner_id !== actor.id) return forbidden(context, 'Only the project owner can do this');
      loaded.set(context, { task, project });
      await next();
    };
  const current = (context: Context) => {
    const found = loaded.get(context);
    if (!found) throw new Error('Route reads the task without loading it');
    return found;
  };

  return new Hono()
    .get('/:id', guard.signedIn, taskAccess('member'), (context) => {
      const { task, project } = current(context);
      const logs = listLogs(task.id);
      const creatorId = logs[0]?.created_by ?? null;
      const people = personRefs(host, [task.assignee_id, creatorId, ...logs.map((log) => log.created_by)]);
      const batch = task.batch_id ? findBatch(task.batch_id) : undefined;
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          task: {
            ...taskView(task, people),
            project: { id: project.id, name: project.name },
            batch: batch ? batchRef(batch) : null,
            created_by: creatorId ? (people.get(creatorId) ?? null) : null,
            logs: logs.map((log) => logView(log, people)),
          },
        },
      } satisfies TaskDetailSuccess);
    })
    .patch('/:id', guard.signedIn, taskAccess('member'), jsonInput(updateTaskInputSchema), (context) => {
      const actor = guard.actor(context);
      const { task, project } = current(context);
      const { revision, assignee_id, ...patch } = context.req.valid('json');
      if (assignee_id && assignee_id !== task.assignee_id && !assignable(host, project, assignee_id)) return assigneeRefused(context);
      const update = updateTask(task.id, { ...patch, assigneeId: assignee_id }, revision, actor.id);
      if (update.status === 'missing') return taskNotFound(context);
      if (update.status === 'stale') {
        return context.json(
          {
            success: false as const,
            message: 'This task changed elsewhere since you opened it',
            code: STALE_REVISION,
            current: taskViews(host, [update.task])[0],
          },
          409,
        );
      }
      announceBoardChange(projectAudience(host, project));
      return context.json({
        success: true as const,
        message: 'Task updated',
        data: { task: taskViews(host, [update.task])[0] },
      } satisfies TaskSavedSuccess);
    })
    .patch('/:id/move', guard.signedIn, taskAccess('member'), jsonInput(moveTaskInputSchema), (context) => {
      const actor = guard.actor(context);
      const { task, project } = current(context);
      const input = context.req.valid('json');
      if (input.column_id === task.column_id) {
        return refuse(context, 409, 'TASK_ALREADY_IN_COLUMN', 'The task is already in this column');
      }
      const moved = moveTask(task, { column: input.column_id, note: input.note ?? '', sortOrder: input.sort_order }, actor.id);
      const people = personRefs(host, [moved.task.assignee_id, actor.id]);
      announceBoardChange(projectAudience(host, project));
      return context.json({
        success: true as const,
        message: 'Task moved',
        data: { task: taskView(moved.task, people), log: logView(moved.log, people) },
      } satisfies TaskMovedSuccess);
    })
    .delete('/:id', guard.signedIn, taskAccess('owner'), async (context) => {
      const actor = guard.actor(context);
      const { task, project } = current(context);
      const images = deleteTask(task, actor.id);
      announceBoardChange(projectAudience(host, project));
      await removeStoredImages(host, images);
      return context.json({ success: true as const, message: 'Task deleted' } satisfies ProjectsDone);
    })
    .get('/:id/logs', guard.signedIn, taskAccess('member'), (context) => {
      const logs = listLogs(current(context).task.id);
      const people = personRefs(
        host,
        logs.map((log) => log.created_by),
      );
      return context.json({
        success: true as const,
        message: 'OK',
        data: { logs: logs.map((log) => logView(log, people)) },
      } satisfies TaskLogsSuccess);
    })
    .get('/:id/comments', guard.signedIn, taskAccess('member'), (context) => {
      const comments = listComments(current(context).task.id);
      const people = personRefs(
        host,
        comments.map((comment) => comment.user_id),
      );
      return context.json({
        success: true as const,
        message: 'OK',
        data: { comments: comments.map((comment) => commentView(comment, people)) },
      } satisfies CommentsSuccess);
    })
    .post('/:id/comments', guard.signedIn, taskAccess('member'), jsonInput(createCommentInputSchema), (context) => {
      const actor = guard.actor(context);
      const { task, project } = current(context);
      const comment = createComment({ taskId: task.id, userId: actor.id, content: context.req.valid('json').content });
      announceBoardChange(projectAudience(host, project));
      return context.json(
        {
          success: true as const,
          message: 'Comment added',
          data: { comment: commentView(comment, personRefs(host, [actor.id])) },
        } satisfies CommentAddedSuccess,
        201,
      );
    })
    .delete('/:id/comments/:commentId', guard.signedIn, taskAccess('member'), (context) => {
      const actor = guard.actor(context);
      const { task, project } = current(context);
      const comment = findComment(context.req.param('commentId'));
      if (!comment || comment.task_id !== task.id) return commentNotFound(context);
      if (comment.user_id !== actor.id && project.owner_id !== actor.id) {
        return forbidden(context, 'Only the author or the project owner can delete this comment');
      }
      deleteComment(comment.id);
      announceBoardChange(projectAudience(host, project));
      return context.json({ success: true as const, message: 'Comment deleted' } satisfies ProjectsDone);
    })
    .get('/:id/attachments', guard.signedIn, taskAccess('member'), (context) => {
      const attachments = listAttachments(current(context).task.id);
      const people = personRefs(
        host,
        attachments.map((attachment) => attachment.uploaded_by),
      );
      return context.json({
        success: true as const,
        message: 'OK',
        data: { attachments: attachments.map((attachment) => attachmentView(attachment, people)) },
      } satisfies AttachmentsSuccess);
    })
    .get('/:id/attachments/:attachmentId/file', guard.signedIn, taskAccess('member'), async (context) => {
      const { task } = current(context);
      const attachment = findAttachment(context.req.param('attachmentId'));
      if (!attachment || attachment.task_id !== task.id) return attachmentNotFound(context);
      const stored = await host.assetStorage.get(attachment.storage_key);
      if (!stored) return attachmentNotFound(context);
      return new Response(Buffer.from(stored.data), {
        headers: {
          // Only accounts that can open the project may see it, so no shared cache keeps it.
          'Cache-Control': 'private, max-age=3600',
          'Content-Type': attachment.mime_type,
          'Content-Length': String(stored.size),
        },
      });
    })
    .delete('/:id/attachments/:attachmentId', guard.signedIn, taskAccess('member'), async (context) => {
      const actor = guard.actor(context);
      const { task, project } = current(context);
      const attachment = findAttachment(context.req.param('attachmentId'));
      if (!attachment || attachment.task_id !== task.id) return attachmentNotFound(context);
      if (attachment.uploaded_by !== actor.id && project.owner_id !== actor.id) {
        return forbidden(context, 'Only the uploader or the project owner can delete this image');
      }
      deleteAttachment(task, attachment, actor.id);
      announceBoardChange(projectAudience(host, project));
      await removeStoredImages(host, [attachment.storage_key]);
      return context.json({ success: true as const, message: 'Image deleted' } satisfies ProjectsDone);
    });
}

/**
 * Task image uploads, mounted on their own static path so the route can carry
 * a body budget for eight images; the task is named in the query and checked
 * (404, then 403) before the body is read.
 */
/** The signed-in account's dashboard, over the projects it can open. */
export function createDashboardRoutes(host: ProjectsServerHost) {
  const guard = guardFor(host);
  return new Hono().get('/', guard.signedIn, (context) => {
    const actor = guard.actor(context);
    const projects = listProjectsFor(actor.id, host.workspacesOf(actor.id));
    return context.json({ success: true as const, message: 'OK', data: dashboardData(host, actor.id, projects) } satisfies DashboardSuccess);
  });
}

export function createTaskAttachmentRoutes(host: ProjectsServerHost) {
  const guard = guardFor(host);
  return new Hono().post('/', guard.signedIn, queryInput(uploadAttachmentsQuerySchema), async (context) => {
    const actor = guard.actor(context);
    const task = findTask(context.req.valid('query').task_id);
    const project = task ? findProject(task.project_id) : undefined;
    if (!task || !project) return taskNotFound(context);
    if (!canOpenProject(host, project, actor.id)) return forbidden(context, 'You cannot open this project');

    let files: File[];
    try {
      files = uploadedFiles(await context.req.parseBody({ all: true }));
    } catch {
      files = [];
    }
    const { stored, errors } = await storeImages(host, files);
    if (stored.length === 0) {
      return context.json(
        {
          success: false as const,
          message: 'No image was uploaded',
          code: 'NO_FILES_PROCESSED' as const,
          errors: { files: errors.length > 0 ? errors : ['Choose at least one image'] },
        },
        422,
      );
    }
    let rows;
    try {
      rows = addAttachments(task, stored, actor.id);
    } catch (error) {
      await removeStoredImages(
        host,
        stored.map((image) => image.storageKey),
      );
      throw error;
    }
    announceBoardChange(projectAudience(host, project));
    const people = personRefs(host, [actor.id]);
    return context.json(
      {
        success: true as const,
        message: errors.length > 0 ? `${rows.length} uploaded, ${errors.length} failed` : `${rows.length} uploaded`,
        data: { attachments: rows.map((row) => attachmentView(row, people)), errors },
      } satisfies AttachmentsUploadedSuccess,
      201,
    );
  });
}

/**
 * Mounted next to `createTaskAttachmentRoutes`: uploads count toward the
 * strict per-client limit, and their budget is eight full-size images plus
 * a 2 MiB multipart allowance; the per-file checks stay authoritative.
 */
export const TASK_ATTACHMENT_ROUTE_POLICIES = [
  { method: 'POST', path: '/', sensitive: true, bodyMaxBytes: TASK_ATTACHMENT_MAX_FILES * TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES + 2 * 1024 * 1024 },
] as const satisfies readonly RoutePolicy[];
