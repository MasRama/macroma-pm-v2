import { getDatabase } from '../../../shared/database';
import { announceWorkspaceChange } from './live';
import { forgetAccountRows, memberIds, memberRole, workspaceIdsForUser } from './repository';

/** Whether the account belongs to the workspace, as owner or member. */
export function isWorkspaceMember(workspaceId: string, userId: string): boolean {
  return memberRole(workspaceId, userId) !== undefined;
}

/** Every account of the workspace, owner included. */
export function workspaceMemberIds(workspaceId: string): string[] {
  return memberIds(workspaceId);
}

/** The workspaces the account belongs to. */
export function workspacesOf(userId: string): string[] {
  return workspaceIdsForUser(userId);
}

/**
 * Forgets deleted accounts the way V1's foreign keys did: the workspaces they
 * owned go with everything inside, and their memberships, sent invitations
 * and messages go too. Returns the deleted workspaces, so the application can
 * detach the projects that lived in them.
 */
export function forgetAccounts(userIds: readonly string[]): string[] {
  const database = getDatabase();
  const touched = new Set<string>();
  const deleted = database.transaction(() => {
    for (const userId of userIds) {
      for (const workspaceId of workspaceIdsForUser(userId)) for (const member of memberIds(workspaceId)) touched.add(member);
    }
    return forgetAccountRows(userIds);
  })();
  for (const userId of userIds) touched.delete(userId);
  announceWorkspaceChange(touched);
  return deleted;
}
