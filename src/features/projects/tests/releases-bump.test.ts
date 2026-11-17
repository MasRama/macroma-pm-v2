// @vitest-environment jsdom
import { createApp, h, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it } from 'vitest';
import ReleasesView from '../web/components/ReleasesView.vue';
import type { BatchSummary, BatchVersion } from '../web/view';

const counts = { backlog: 0, ongoing: 1, revisi: 0, review: 0, done: 2 };
const active: BatchSummary = { id: 'b2', major: 0, minor: 2, label: 'Billing', openedAt: '2026-11-10T09:00:00.000Z', isActive: true, counts };

let app: App | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  host?.remove();
  app = undefined;
  host = undefined;
});

/** Mounts Rilis as its owner and opens Bump versi; returns the Minor and Major option texts. */
async function bumpOptions(latest: BatchVersion | null): Promise<{ minor: string; major: string }> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
  host = document.createElement('div');
  document.body.append(host);
  app = createApp({ render: () => h(ReleasesView, { projectId: 'p1', activeBatch: active, latest, canBump: true }) });
  app.use(router);
  app.mount(host);
  await router.isReady();
  host.querySelector<HTMLButtonElement>('[data-testid="bump-version"]')!.click();
  await nextTick();
  const text = (kind: string) => document.querySelector(`[data-testid="bump-${kind}"]`)?.textContent ?? '';
  return { minor: text('minor'), major: text('major') };
}

describe('Bump versi on Rilis', () => {
  it('counts on the project\'s highest batch, like the board, while closing the active one', async () => {
    // Rilis passes latestBatchVersion of every batch as `latest`: here v0.3, above the active v0.2.
    const options = await bumpOptions({ major: 0, minor: 3 });
    expect(options.minor).toContain('v0.3 → v0.4');
    expect(options.major).toContain('v0.3 → v1.0');
    expect(options.minor).toContain('Batch v0.2 ditutup.');
  });

  it('falls back to the active batch when no latest batch is given', async () => {
    const options = await bumpOptions(null);
    expect(options.minor).toContain('v0.2 → v0.3');
  });
});
