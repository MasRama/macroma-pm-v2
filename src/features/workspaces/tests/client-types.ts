import { hc } from 'hono/client';
import type { createInvitationRoutes, createWorkspaceRoutes } from '..';
import type { WorkspacesError } from '../contract';

/**
 * Compile-time checks that the web client sees the real routes: `npm run lint`
 * fails when they stop matching, including when an `@ts-expect-error` below
 * stops being an error. Never called.
 */
export async function workspacesRouteTypes(): Promise<void> {
  const workspaces = hc<ReturnType<typeof createWorkspaceRoutes>>('/api/workspaces');
  const invitations = hc<ReturnType<typeof createInvitationRoutes>>('/api/invitations');

  const listed = await (await workspaces.index.$get()).json();
  if (listed.success) {
    const count: number = listed.data.workspaces[0].project_count;
    void count;
  }

  // @ts-expect-error an edit carries the revision it was based on
  await workspaces[':id'].$patch({ param: { id: 'w' }, json: { name: 'No revision' } });
  // @ts-expect-error invitations are answered with accept or decline
  await invitations[':token'].respond.$post({ param: { token: 't' }, json: { action: 'maybe' } });

  const stale: WorkspacesError = { success: false, message: 'Stale', code: 'STALE_REVISION' };
  void stale;
  // @ts-expect-error Workspaces declares no NOT_FOUND refusal
  const undeclared: WorkspacesError = { success: false, message: 'Not found', code: 'NOT_FOUND' };
  void undeclared;
}
