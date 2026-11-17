// @vitest-environment jsdom
import { createApp, h, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it } from 'vitest';
import ReleasesView from '../web/components/ReleasesView.vue';
import type { ReleaseSummary } from '../web/view';

const release = (id: string, label: string): ReleaseSummary => ({
  id,
  major: 2,
  minor: 0,
  label,
  openedAt: '2026-08-02T02:00:00.000Z',
  closedAt: '2026-09-29T02:00:00.000Z',
  taskCount: 31,
  isMajor: true,
});

let app: App | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  app?.unmount();
  host?.remove();
  app = undefined;
  host = undefined;
});

async function titleOf(label: string): Promise<HTMLElement> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
  host = document.createElement('div');
  document.body.append(host);
  app = createApp({ render: () => h(ReleasesView, { projectId: 'p1', releases: [release('b20', label)] }) });
  app.use(router);
  app.mount(host);
  await router.isReady();
  return host.querySelector<HTMLElement>('[data-release-id="b20"] .release__title')!;
}

describe('the MAJOR mark in SUDAH RILIS', () => {
  it('opens the title of an unlabeled release, so it lines up with the dates below', async () => {
    // The mark is spaced from the label by the title's gap, not a margin of its own: with no label
    // there is no empty label element in front of it and nothing pushes it right.
    const title = await titleOf('');
    expect(title.querySelector('b')).toBeNull();
    expect(title.firstElementChild?.className).toBe('release__major');
    expect(title.textContent?.trim()).toBe('MAJOR');
  });

  it('follows the label of a labeled release', async () => {
    const title = await titleOf('Multi-device rewrite');
    expect([...title.children].map((node) => node.textContent?.trim())).toEqual(['Multi-device rewrite', 'MAJOR']);
  });
});
