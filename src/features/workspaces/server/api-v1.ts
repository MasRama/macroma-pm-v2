import { Hono } from 'hono';
import {
  apiWorkspacesQuerySchema,
  type ApiWorkspaceMembersSuccess,
  type ApiWorkspacesSuccess,
  type ApiWorkspaceSuccess,
  type WorkspaceMember,
  type WorkspaceSummary,
} from '../contract';
import { createGuard, newestFirstAfter, pageAfter, queryInput } from '../../../shared/security';
import { workspaceLoader } from './access-loaders';
import type { WorkspacesServerHost } from './host';
import { countMembers, listMembers, listWorkspacesForUser } from './repository';

/**
 * Workspaces in the public API (`/api/v1/workspaces`), read-only. The caller
 * is the account of the request's bearer token, never a session cookie; the
 * same loader as the browser routes answers 404 and 403.
 */
export function createWorkspacesApiRoutes(host: WorkspacesServerHost) {
  const guard = createGuard((context) => host.apiActor(context));
  const { workspaceAccess, current } = workspaceLoader(guard.actor);

  function members(workspaceId: string): WorkspaceMember[] {
    const rows = listMembers(workspaceId);
    const accounts = new Map(host.findAccountsByIds(rows.map((row) => row.user_id)).map((person) => [person.id, person]));
    // An account Auth no longer has is left out until its deletion reaches this Feature.
    return rows.flatMap((row) => {
      const user = accounts.get(row.user_id);
      return user ? [{ user, role: row.role, joined_at: row.created_at }] : [];
    });
  }

  return new Hono()
    .get('/', guard.signedIn, queryInput(apiWorkspacesQuerySchema), (context) => {
      const actor = guard.actor(context);
      // An account belongs to few workspaces: they page in memory, newest first.
      const page = pageAfter(listWorkspacesForUser(actor.id), context.req.valid('query'), newestFirstAfter, (row) => ({
        at: row.created_at,
        id: row.id,
      }));
      const projectCounts = host.projectCounts(page.items.map((row) => row.id));
      const workspaces: WorkspaceSummary[] = page.items.map(({ role, member_count, ...workspace }) => ({
        ...workspace,
        role,
        member_count,
        project_count: projectCounts[workspace.id] ?? 0,
      }));
      return context.json({
        success: true as const,
        message: 'OK',
        data: { workspaces, next_cursor: page.nextCursor },
      } satisfies ApiWorkspacesSuccess);
    })
    .get('/:id', guard.signedIn, workspaceAccess('member'), (context) => {
      const { workspace, role } = current(context);
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          workspace: {
            ...workspace,
            role,
            member_count: countMembers(workspace.id),
            project_count: host.projectCounts([workspace.id])[workspace.id] ?? 0,
          },
        },
      } satisfies ApiWorkspaceSuccess);
    })
    .get('/:id/members', guard.signedIn, workspaceAccess('member'), (context) => {
      return context.json({
        success: true as const,
        message: 'OK',
        data: { members: members(current(context).workspace.id) },
      } satisfies ApiWorkspaceMembersSuccess);
    });
}
