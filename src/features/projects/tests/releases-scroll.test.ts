// @vitest-environment jsdom
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectsResponseSchemas } from '../contract';
import ReleasesView from '../web/components/ReleasesView.vue';
import { toReleaseDetail, type ReleaseDetail, type ReleaseSummary } from '../web/view';

const DAY = 24 * 60 * 60 * 1000;
const opened = Date.UTC(2026, 9, 14, 2);

function release(id: string, minor: number): ReleaseSummary {
  return { id, major: 0, minor, label: `Rilis ${minor}`, openedAt: new Date(opened).toISOString(), closedAt: new Date(opened + DAY).toISOString(), taskCount: 1, isMajor: false };
}

/** A release detail as GET /api/projects/:id/releases/:batchId sends it, checked against the contract. */
function detailOf(id: string, minor: number): ReleaseDetail {
  const body = {
    success: true,
    message: 'Release loaded.',
    data: {
      batch: { id, major: 0, minor, label: `Rilis ${minor}`, created_at: opened, opened_at: opened, closed_at: opened + DAY, task_count: 1, major_bump: false, is_active: false },
      stats: { task_count: 1, duration_days: 1, revisi_task_count: 0 },
      changelog: [{ task_id: `t${minor}`, title: `Task ${minor}`, priority: 'low', version: { major: 0, minor, patch: 1 }, assignee: null, column_id: 'done' }],
      contributors: [],
    },
  };
  return toReleaseDetail(projectsResponseSchemas().releaseDetail.parse(body).data);
}

let app: App | undefined;
let host: HTMLElement | undefined;
/** Release panels scrolled into view. */
let scrolled: HTMLElement[] = [];

beforeEach(() => {
  scrolled = [];
  // One column, as on phones and tablets.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 1100px)', media: query, addEventListener() {}, removeEventListener() {} }));
  // Only the release panel counts; other parts (the tabs) scroll their own items.
  Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    if (this.matches('[data-testid^="release-detail"]')) scrolled.push(this);
  };
});
afterEach(() => {
  app?.unmount();
  host?.remove();
  app = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe('picking a release on a phone', () => {
  it('scrolls to the changelog only once the picked release has loaded', async () => {
    const releases = [release('b2', 2), release('b1', 1)];
    const selected = shallowRef('b2');
    const detail = shallowRef<ReleaseDetail | null>(detailOf('b2', 2));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
    host = document.createElement('div');
    document.body.append(host);
    app = createApp({
      render: () =>
        h(ReleasesView, {
          projectId: 'p1',
          releases,
          selectedId: selected.value,
          detail: detail.value,
          'onUpdate:selectedId': (id: string) => {
            selected.value = id;
          },
        }),
    });
    app.use(router);
    app.mount(host);
    await router.isReady();

    host.querySelector<HTMLButtonElement>('[data-release-id="b1"]')!.click();
    await nextTick();
    await nextTick();
    // The old, longer changelog is still on screen: scrolling now would land on a spot the short one clamps away.
    expect(scrolled).toEqual([]);

    detail.value = detailOf('b1', 1);
    await nextTick();
    await nextTick();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.dataset.testid).toBe('release-detail');
    expect(scrolled[0]!.textContent).toContain('Task 1');
  });

  it('scrolls to the message when the picked release fails to load', async () => {
    const detailError = shallowRef('');
    const detail = shallowRef<ReleaseDetail | null>(detailOf('b2', 2));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
    host = document.createElement('div');
    document.body.append(host);
    app = createApp({
      render: () => h(ReleasesView, { projectId: 'p1', releases: [release('b2', 2), release('b1', 1)], selectedId: 'b2', detail: detail.value, detailError: detailError.value }),
    });
    app.use(router);
    app.mount(host);
    await router.isReady();

    host.querySelector<HTMLButtonElement>('[data-release-id="b1"]')!.click();
    await nextTick();
    expect(scrolled).toEqual([]);
    detail.value = null;
    detailError.value = 'Rilis ini sudah tidak ada. Pilih rilis lain di kiri.';
    await nextTick();
    await nextTick();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.dataset.testid).toBe('release-detail-empty');
  });

  it('scrolls right away when the picked release is already the one shown', async () => {
    const detail = detailOf('b2', 2);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
    host = document.createElement('div');
    document.body.append(host);
    app = createApp({ render: () => h(ReleasesView, { projectId: 'p1', releases: [release('b2', 2)], selectedId: 'b2', detail }) });
    app.use(router);
    app.mount(host);
    await router.isReady();

    host.querySelector<HTMLButtonElement>('[data-release-id="b2"]')!.click();
    await nextTick();
    await nextTick();
    expect(scrolled).toHaveLength(1);
  });
});
