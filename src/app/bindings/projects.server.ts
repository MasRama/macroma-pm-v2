import { resolve } from 'node:path';
import type { Hono } from 'hono';
import { findAccountByEmail, findAccountsByIds, getCurrentUser, onAccountsDeleted, SESSION_COOKIE_NAME } from '../../features/auth';
import {
  createDashboardRoutes,
  createProjectRoutes,
  createTaskAttachmentRoutes,
  createTaskRoutes,
  forgetAccounts,
  TASK_ATTACHMENT_ROUTE_POLICIES,
  type ProjectPerson,
  type ProjectsServerHost,
} from '../../features/projects';
import { notify } from '../../features/notifications';
import { isWorkspaceMember, workspaceMemberIds, workspaceOpenings, workspacesOf } from '../../features/workspaces';
import { declareRoutePolicies } from '../../shared/security';
import { createLocalAssetStorage } from '../../shared/storage';

function person(account: ProjectPerson): ProjectPerson {
  return { id: account.id, name: account.name, email: account.email, avatar: account.avatar };
}

/** Application-owned adapter: Auth supplies accounts, Workspaces the workspace membership, Notifications the notices. */
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
  workspaceOpenings,
  assetStorage: createLocalAssetStorage({ root: resolve(process.cwd(), 'storage') }),
  notify: (userId, type, data) => {
    notify(userId, type, data);
  },
};

// Projects keep no foreign keys into Auth's users table; deleted accounts are forgotten here.
onAccountsDeleted((userIds) => forgetAccounts(projectsServerHost, userIds));

export default function composeProjectsServer(app: Hono): void {
  app.route('/api/projects', createProjectRoutes(projectsServerHost));
  app.route('/api/tasks', createTaskRoutes(projectsServerHost));
  app.route('/api/dashboard', createDashboardRoutes(projectsServerHost));
  declareRoutePolicies(app, '/api/task-attachments', TASK_ATTACHMENT_ROUTE_POLICIES);
  app.route('/api/task-attachments', createTaskAttachmentRoutes(projectsServerHost));
}
