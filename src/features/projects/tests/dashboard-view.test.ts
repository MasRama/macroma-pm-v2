// @vitest-environment jsdom
import { createApp, h, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it } from 'vitest';
import { projectsResponseSchemas, type DashboardSuccess } from '../contract';
import DashboardView from '../web/components/DashboardView.vue';
import { toDashboard } from '../web/view';

let app: App | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  app?.unmount();
  host?.remove();
  app = undefined;
  host = undefined;
});

/** GET /api/dashboard data for 5 projects of which 2 have tasks in ongoing, revisi or review, checked against the contract. */
function dashboardData(): DashboardSuccess['data'] {
  const body = {
    success: true,
    message: 'OK',
    data: {
      stats: {
        workspace_count: 1,
        project_count: 5,
        counts: { backlog: 4, ongoing: 2, revisi: 1, review: 1, done: 3 },
        active_project_count: 2,
        total: 11,
        done_this_week: 1,
        done_last_week: 1,
        ongoing_mine: 1,
        revisi_repeated: 0,
      },
      trends: [],
      tasks_per_project: [],
      board_health: [],
      recent_activity: [],
      projects: [],
    },
  };
  return projectsResponseSchemas().dashboard.parse(body).data;
}

describe('the dashboard project count', () => {
  it('counts only the projects with active tasks, in the "Task aktif" note and the greeting line', async () => {
    const data = toDashboard(dashboardData());
    expect(data.stats.activeProjects).toBe(2);

    const blank = { render: () => null };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/feed', name: 'feed', component: blank },
        { path: '/projects/:projectId/board', name: 'project-board', component: blank },
        { path: '/:any(.*)*', component: blank },
      ],
    });
    host = document.createElement('div');
    document.body.append(host);
    app = createApp({ render: () => h(DashboardView, { userName: 'Ren', workspaceCount: data.workspaceCount, stats: data.stats }) });
    app.use(router);
    app.mount(host);
    await router.isReady();

    const active = host.querySelector('.stat')!;
    expect(active.querySelector('.stat__value')?.textContent?.trim()).toBe('4');
    expect(active.querySelector('.stat__note')?.textContent?.trim()).toBe('di 2 project');
    expect(host.textContent).toContain('1 workspace, 2 project jalan.');
    expect(host.textContent).not.toContain('5 project');
  });
});
