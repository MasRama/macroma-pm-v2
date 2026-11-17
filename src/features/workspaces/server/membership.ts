import { getDatabase } from '../../../shared/database';
import { WORKSPACE_NOTIFICATION_TYPES } from '../contract';
import type { WorkspacesServerHost } from './host';
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

/** Takes back the notices of invitations that no longer exist, so no dead token is left to answer. */
export function withdrawInvitationNotices(host: Pick<WorkspacesServerHost, 'withdrawNotifications'>, tokens: Iterable<string>): void {
  for (const token of tokens) host.withdrawNotifications(WORKSPACE_NOTIFICATION_TYPES.invitation, 'token', token);
}

/**
 * Forgets deleted accounts the way V1's foreign keys did: the workspaces they
 * owned go with everything inside, and their memberships, sent invitations
 * and messages go too, with the notices of the pending invitations among
 * them. Returns the deleted workspaces with the remaining accounts that
 * belonged to them, so the application can detach the projects that lived
 * in them.
 */
export function forgetAccounts(
  host: Pick<WorkspacesServerHost, 'withdrawNotifications'>,
  userIds: readonly string[],
): Array<{ workspaceId: string; formerMemberIds: string[] }> {
  const database = getDatabase();
  const touched = new Set<string>();
  const members = new Map<string, string[]>();
  const deleted = database.transaction(() => {
    for (const userId of userIds) {
      for (const workspaceId of workspaceIdsForUser(userId)) {
        if (!members.has(workspaceId)) members.set(workspaceId, memberIds(workspaceId));
        for (const member of members.get(workspaceId) ?? []) touched.add(member);
      }
    }
    const forgotten = forgetAccountRows(userIds);
    withdrawInvitationNotices(host, forgotten.invitationTokens);
    return forgotten.workspaces;
  })();
  const forgottenIds = new Set(userIds);
  for (const userId of userIds) touched.delete(userId);
  announceWorkspaceChange(touched);
  return deleted.map((workspaceId) => ({
    workspaceId,
    formerMemberIds: (members.get(workspaceId) ?? []).filter((member) => !forgottenIds.has(member)),
  }));
}
