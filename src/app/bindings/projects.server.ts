import type { Hono } from 'hono';
import { findAccountByEmail, findAccountsByIds, getCurrentUser, onAccountsDeleted, SESSION_COOKIE_NAME } from '../../features/auth';
import { createProjectRoutes, createTaskRoutes, forgetAccounts, type ProjectPerson, type ProjectsServerHost } from '../../features/projects';
import { isWorkspaceMember, workspaceMemberIds, workspacesOf } from '../../features/workspaces';

function person(account: ProjectPerson): ProjectPerson {
  return { id: account.id, name: account.name, email: account.email, avatar: account.avatar };
}

/** Application-owned adapter: Auth supplies accounts, Workspaces the workspace membership. */
export const projectsServerHost: ProjectsServerHost = {
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
  isWorkspaceMember,
  workspaceMemberIds,
  workspacesOf,
};

// Projects keep no foreign keys into Auth's users table; deleted accounts are forgotten here.
onAccountsDeleted((userIds) => forgetAccounts(projectsServerHost, userIds));

export default function composeProjectsServer(app: Hono): void {
  app.route('/api/projects', createProjectRoutes(projectsServerHost));
  app.route('/api/tasks', createTaskRoutes(projectsServerHost));
}
