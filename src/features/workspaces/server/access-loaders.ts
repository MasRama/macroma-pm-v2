import type { Context, MiddlewareHandler } from 'hono';
import type { Workspace } from '../contract';
import { forbidden } from '../../../shared/security';
import { workspaceNotFound } from './refusals';
import { findWorkspace, memberRole, type WorkspaceRole } from './repository';

/**
 * Loads the `:id` workspace ahead of input validation: 404 when it does not
 * exist, 403 unless the caller belongs to it (or owns it, for `owner`). The
 * browser routes and the public API share it, so both refuse alike.
 */
export function workspaceLoader(actorOf: (context: Context) => { id: string }) {
  const loaded = new WeakMap<Context, { workspace: Workspace; role: WorkspaceRole }>();
  const workspaceAccess =
    (need: 'member' | 'owner'): MiddlewareHandler =>
    async (context, next) => {
      const actor = actorOf(context);
      const workspace = findWorkspace(context.req.param('id') ?? '');
      if (!workspace) return workspaceNotFound(context);
      const role = memberRole(workspace.id, actor.id);
      if (!role) return forbidden(context, 'You are not a member of this workspace');
      if (need === 'owner' && workspace.owner_id !== actor.id) return forbidden(context, 'Only the workspace owner can do this');
      loaded.set(context, { workspace, role });
      await next();
    };
  const current = (context: Context) => {
    const found = loaded.get(context);
    if (!found) throw new Error('Route reads the workspace without loading it');
    return found;
  };
  return { workspaceAccess, current };
}
