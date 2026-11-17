import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../../resources/index.css';
import { createApp, defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useAuthSession } from '../../src/features/auth/web';
import Harness from './Harness.vue';
import { pathFor, screenName } from './screens';

const Blank = defineComponent({ render: () => null });
const names = [
  ['/login', 'login'],
  ['/register', 'register'],
  ['/forgot-password', 'forgot-password'],
  ['/reset-password', 'reset-password'],
  ['/dashboard', 'dashboard'],
  ['/feed', 'feed'],
  ['/workspaces/:workspaceId', 'workspace'],
  ['/projects/:projectId/board', 'project-board'],
  ['/projects/:projectId/tasks/:taskId', 'project-task'],
  ['/projects/:projectId/releases', 'project-releases'],
  ['/projects/:projectId/activity', 'project-activity'],
  ['/profile', 'profile'],
  ['/change-password', 'change-password'],
  ['/users', 'users'],
  ['/roles', 'roles'],
  ['/activity', 'activity'],
  ['/security', 'security'],
  ['/:pathMatch(.*)*', 'not-found'],
] as const;

const params = new URLSearchParams(window.location.search);
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');

const router = createRouter({
  history: createMemoryHistory(),
  routes: names.map(([path, name]) => ({ path, name, component: Blank })),
});
void router.push(pathFor(screenName(params.get('screen'))));
await router.isReady();
// Pages that check permissions read the session; shoot.cjs answers /api/auth/me per screen.
await useAuthSession().load().catch(() => undefined);
createApp(Harness).use(router).mount('#app');
