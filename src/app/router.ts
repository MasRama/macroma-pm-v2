import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type RouterScrollBehavior,
} from 'vue-router';
import { ChangePasswordPage, rolesAccess, RolesPage, SecurityPage, useAuthSession } from '../features/auth/web';
import { ActivityPage, BoardPage, DashboardPage, ReleasesPage } from '../features/projects/web';
import { WorkspacePage } from '../features/workspaces/web';
import { projectsClient, workspacesClient } from './api-clients';
import { currentWorkspace, newWorkspaceOpen, workspaceNameOf } from './shell-state';
import activityWebRoutes from './bindings/activity.web';
import usersWebRoutes from './bindings/users.web';
import { canEnter } from './navigation';
import ApiDocsPage from './pages/ApiDocsPage.vue';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.vue';
import LoginPage from './pages/auth/LoginPage.vue';
import RegisterPage from './pages/auth/RegisterPage.vue';
import ResetPasswordPage from './pages/auth/ResetPasswordPage.vue';
import UsersAdminPage from './pages/admin/UsersAdminPage.vue';
import NotFoundPage from './pages/NotFoundPage.vue';
import ProfilePage from './pages/ProfilePage.vue';
import TokensPage from './pages/TokensPage.vue';

const authSession = useAuthSession();
const signedIn = { requiresAuth: true } as const;

/*
 * Macroma screens. Pages wired to the Macroma API get its typed client and
 * what they need from the shell; the rest still render from the URL alone and
 * show their empty state. The official Users binding keeps the /users route,
 * name and access rule; Macroma draws it with its own Pengguna page, and its
 * /profile is replaced by the app's Profil page.
 */
const boardProps = (route: RouteLocationNormalized) => ({
  projectId: String(route.params.projectId),
  taskId: route.params.taskId ? String(route.params.taskId) : null,
  client: projectsClient,
  workspaceNameOf,
  meId: authSession.user.value?.id ?? null,
});
export const appRoutes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', name: 'login', component: LoginPage, meta: { guestOnly: true } },
  { path: '/register', name: 'register', component: RegisterPage, meta: { guestOnly: true } },
  { path: '/forgot-password', name: 'forgot-password', component: ForgotPasswordPage, meta: { guestOnly: true } },
  { path: '/reset-password', name: 'reset-password', component: ResetPasswordPage, meta: { guestOnly: true } },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardPage,
    props: () => ({
      client: projectsClient,
      // The greeting uses the first name: "Pagi, Ren".
      userName: authSession.user.value?.name.trim().split(/\s+/)[0] ?? '',
      currentWorkspace: () => (currentWorkspace.value ? { id: currentWorkspace.value.id, name: currentWorkspace.value.name } : null),
      onNewWorkspace: () => {
        newWorkspaceOpen.value = true;
      },
    }),
    meta: signedIn,
  },
  { path: '/feed', name: 'feed', component: ActivityPage, meta: signedIn },
  {
    path: '/workspaces/:workspaceId',
    name: 'workspace',
    component: WorkspacePage,
    props: (route) => ({
      workspaceId: String(route.params.workspaceId),
      client: workspacesClient,
      projectsClient,
      meId: authSession.user.value?.id ?? null,
    }),
    meta: signedIn,
  },
  { path: '/projects/:projectId', redirect: (to) => ({ name: 'project-board', params: to.params }) },
  {
    path: '/projects/:projectId/board',
    name: 'project-board',
    component: BoardPage,
    props: boardProps,
    meta: signedIn,
  },
  {
    path: '/projects/:projectId/tasks/:taskId',
    name: 'project-task',
    component: BoardPage,
    props: boardProps,
    meta: signedIn,
  },
  {
    path: '/projects/:projectId/releases',
    name: 'project-releases',
    component: ReleasesPage,
    props: (route: RouteLocationNormalized) => ({ projectId: String(route.params.projectId), client: projectsClient, workspaceNameOf }),
    meta: signedIn,
  },
  {
    path: '/projects/:projectId/activity',
    name: 'project-activity',
    component: ActivityPage,
    props: true,
    meta: signedIn,
  },
  { path: '/profile', name: 'profile', component: ProfilePage, meta: signedIn },
  { path: '/settings/tokens', name: 'api-tokens', component: TokensPage, meta: signedIn },
  {
    path: '/change-password',
    name: 'change-password',
    component: ChangePasswordPage,
    meta: { requiresAuth: true, standaloneAuth: true },
  },
  // Admin pages: meta.nav lists them in the sidebar's ADMIN section, in this order.
  ...usersWebRoutes
    .filter((route) => route.name === 'users')
    .map((route) => ({ ...route, component: UsersAdminPage, props: false })),
  {
    path: '/roles',
    name: 'roles',
    component: RolesPage,
    meta: { requiresAuth: true, requiresAccess: rolesAccess('view'), nav: { label: 'Roles' } },
  },
  ...activityWebRoutes,
  { path: '/security', name: 'security', component: SecurityPage, meta: signedIn },
  { path: '/settings/api-docs', name: 'api-docs', component: ApiDocsPage, meta: signedIn },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage },
] satisfies RouteRecordRaw[];

export const appScrollBehavior: RouterScrollBehavior = (to, _from, savedPosition) => {
  if (savedPosition) return savedPosition;
  if (to.hash) return { el: to.hash };
  return { top: 0 };
};

const router = createRouter({
  history: createWebHistory(),
  routes: appRoutes,
  scrollBehavior: appScrollBehavior,
});

router.beforeEach(async (to) => {
  try {
    // Protected and guest-only destinations need a fresh server decision so
    // revoked/expired sessions and permission changes take effect on the next
    // navigation. Public pages only need the one-time bootstrap.
    if (to.meta.requiresAuth || to.meta.guestOnly) await authSession.refresh();
    else await authSession.load();
  } catch {
    // A transient server/network failure must not erase a previously valid
    // browser session. If no authenticated state has ever been established,
    // cancel protected navigation rather than converting uncertainty into a
    // logout redirect.
    if (to.meta.requiresAuth && !authSession.isAuthenticated.value) return false;
  }

  if (to.meta.requiresAuth && !authSession.isAuthenticated.value) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
    };
  }

  if (
    authSession.isAuthenticated.value &&
    authSession.user.value?.mustChangePassword === true &&
    to.name !== 'change-password'
  ) {
    return { name: 'change-password' };
  }
  if (!canEnter(to.meta, authSession.allows)) {
    return { name: 'dashboard' };
  }

  if (to.meta.guestOnly && authSession.isAuthenticated.value) {
    return { name: 'dashboard' };
  }

  return true;
});

export default router;
