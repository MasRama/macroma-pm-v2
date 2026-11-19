import type { Hono } from 'hono';
import {
  apiTokenAccount,
  findAccountByEmail,
  findAccountsByIds,
  getCurrentUser,
  onAccountsDeleted,
  SESSION_COOKIE_NAME,
} from '../../features/auth';
import { notify, withdrawNotifications } from '../../features/notifications';
import { detachWorkspace, workspaceMembersLeft, workspaceProjectCounts } from '../../features/projects';
import { projectsServerHost } from './projects.server';
import {
  createInvitationRoutes,
  createWorkspaceRoutes,
  createWorkspacesApiRoutes,
  forgetAccounts,
  type WorkspacePerson,
  type WorkspacesServerHost,
} from '../../features/workspaces';

function person(account: WorkspacePerson): WorkspacePerson {
  return { id: account.id, name: account.name, email: account.email, avatar: account.avatar };
}

/** Application-owned adapter: Auth supplies accounts, Notifications the notices. */
export const workspacesServerHost: WorkspacesServerHost = {
  sessionCookieName: SESSION_COOKIE_NAME,
  resolveActor: (sessionToken) => {
    const user = getCurrentUser(sessionToken);
    return user ? { id: user.id, name: user.name, email: user.email } : undefined;
  },
  apiActor: (context) => apiTokenAccount(context),
  findAccountsByIds: (userIds) => findAccountsByIds(userIds).map(person),
  findAccountByEmail: (email) => {
    const account = findAccountByEmail(email);
    return account ? person(account) : undefined;
  },
  notify: (userId, type, data) => {
    notify(userId, type, data);
  },
  withdrawNotifications: (type, field, value) => {
    withdrawNotifications(type, field, value);
  },
  projectCounts: (workspaceIds) => workspaceProjectCounts(workspaceIds),
  workspaceDeleted: (workspaceId, formerMemberIds) => detachWorkspace(projectsServerHost, workspaceId, formerMemberIds),
  membersLeft: (workspaceId, userIds) => workspaceMembersLeft(projectsServerHost, workspaceId, userIds),
};

// Workspaces keep no foreign keys into Auth's users table; deleted accounts are forgotten here.
onAccountsDeleted((userIds) => {
  for (const { workspaceId, formerMemberIds } of forgetAccounts(workspacesServerHost, userIds)) {
    workspacesServerHost.workspaceDeleted(workspaceId, formerMemberIds);
  }
});

export default function composeWorkspacesServer(app: Hono): void {
  app.route('/api/workspaces', createWorkspaceRoutes(workspacesServerHost));
  app.route('/api/invitations', createInvitationRoutes(workspacesServerHost));
  // The public API: bearer tokens only, behind the application's token pipeline.
  app.route('/api/v1/workspaces', createWorkspacesApiRoutes(workspacesServerHost));
}
