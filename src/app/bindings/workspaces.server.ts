import type { Hono } from 'hono';
import {
  findAccountByEmail,
  findAccountsByIds,
  getCurrentUser,
  onAccountsDeleted,
  SESSION_COOKIE_NAME,
} from '../../features/auth';
import { notify, withdrawNotifications } from '../../features/notifications';
import {
  createInvitationRoutes,
  createWorkspaceRoutes,
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
  // No Feature holds projects yet; workspaces count none and have none to detach.
  projectCounts: () => ({}),
  workspaceDeleted: () => undefined,
};

// Workspaces keep no foreign keys into Auth's users table; deleted accounts are forgotten here.
onAccountsDeleted((userIds) => {
  for (const workspaceId of forgetAccounts(userIds)) workspacesServerHost.workspaceDeleted(workspaceId);
});

export default function composeWorkspacesServer(app: Hono): void {
  app.route('/api/workspaces', createWorkspaceRoutes(workspacesServerHost));
  app.route('/api/invitations', createInvitationRoutes(workspacesServerHost));
}
