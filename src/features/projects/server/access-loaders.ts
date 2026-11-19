import type { Context, MiddlewareHandler } from 'hono';
import type { Project } from '../contract';
import { forbidden } from '../../../shared/security';
import { canOpenProject } from './access';
import type { ProjectsServerHost } from './host';
import { projectNotFound, taskNotFound } from './refusals';
import { findProject, findTask, type TaskRow } from './repository';

/** The account a guard on the route already resolved. */
type ActorOf = (context: Context) => { id: string };

/**
 * Loads the `:id` project ahead of input validation: 404 when it does not
 * exist, 403 unless the caller can open it (or owns it, for `owner`). The
 * browser routes and the public API share it, so both refuse alike.
 */
export function projectLoader(host: ProjectsServerHost, actorOf: ActorOf) {
  const loaded = new WeakMap<Context, Project>();
  const projectAccess =
    (need: 'member' | 'owner'): MiddlewareHandler =>
    async (context, next) => {
      const actor = actorOf(context);
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
  return { projectAccess, current };
}

/**
 * Loads the `:id` task and its project ahead of input validation: 404 when
 * the task does not exist, 403 unless the caller can open its project (or
 * owns it, for `owner`).
 */
export function taskLoader(host: ProjectsServerHost, actorOf: ActorOf) {
  const loaded = new WeakMap<Context, { task: TaskRow; project: Project }>();
  const taskAccess =
    (need: 'member' | 'owner'): MiddlewareHandler =>
    async (context, next) => {
      const actor = actorOf(context);
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
  return { taskAccess, current };
}
