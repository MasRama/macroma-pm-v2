// @vitest-environment jsdom
import { createApp, h, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { projectsResponseSchemas, type TaskLog } from '../contract';
import TimelineNode from '../web/components/TimelineNode.vue';
import { toTaskLog } from '../web/view';

/** A task-log row as GET /api/tasks/:id/logs sends it, checked against the contract first. */
function logRow(overrides: Partial<TaskLog>): TaskLog {
  const row: TaskLog = {
    id: 'log-1',
    version: 'v0.1.2',
    column_from: 'backlog',
    column_to: 'ongoing',
    note: 'Mulai dikerjakan.',
    user: { id: 'u1', name: 'Ren Owner', avatar: null },
    created_at: Date.UTC(2026, 10, 17, 10, 0),
    ...overrides,
  };
  return projectsResponseSchemas().taskLogs.parse({ success: true, message: 'OK', data: { logs: [row] } }).data.logs[0]!;
}

let app: App | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  app?.unmount();
  host?.remove();
  app = undefined;
  host = undefined;
});

function render(row: TaskLog): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  app = createApp({ render: () => h('ul', [h(TimelineNode, { entry: toTaskLog(row) })]) });
  app.mount(host);
  return host;
}
const flat = (node: Element) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('Riwayat versi entries', () => {
  it('reads #30\'s entry (no kind, same column on both sides, note "Moved into batch v0.1") as "Masuk batch v0.1", with no move and no English note', () => {
    const row = logRow({ version: 'v0.1.2', column_from: 'revisi', column_to: 'revisi', note: 'Moved into batch v0.1' });
    expect(toTaskLog(row).kind).toBe('adopt');
    const node = render(row);
    expect(flat(node.querySelector('[data-testid="log-adopt"]')!)).toBe('Masuk batch v0.1');
    expect(node.querySelector('.node__arrow')).toBeNull();
    expect(node.querySelector('.blk')).toBeNull();
    expect(flat(node)).not.toContain('Moved into batch');
    expect(node.querySelector('.node__note')).toBeNull();
  });

  it('takes the batch from the entry\'s own version, so a major first batch reads v1.0', () => {
    const node = render(logRow({ version: 'v1.0.3', column_from: 'backlog', column_to: 'backlog', note: 'Moved into batch v1.0' }));
    expect(flat(node.querySelector('[data-testid="log-adopt"]')!)).toBe('Masuk batch v1.0');
  });

  it('shows an imported V1 same-column row with a user note as a plain note: author and note, no arrow, no Masuk batch', () => {
    // V1 "+Log" rows kept the task's column on both sides and carried the user's own note.
    const row = logRow({ version: 'v0.3.4', column_from: 'revisi', column_to: 'revisi', note: 'Warna tombol masih beda, tunggu klien.' });
    expect(toTaskLog(row).kind).toBe('note');
    const node = render(row);
    expect(node.querySelector('[data-testid="log-adopt"]')).toBeNull();
    expect(node.querySelector('.node__arrow')).toBeNull();
    expect(node.querySelector('.blk')).toBeNull();
    expect(flat(node)).not.toContain('Masuk batch');
    expect(flat(node.querySelector('.node__note p')!)).toBe('Ren Owner Warna tombol masih beda, tunggu klien.');
  });

  it('shows a V1 move mapped backlog to backlog as a plain note too, and reads any note starting "Moved into batch" as an adopt', () => {
    const odd = logRow({ version: 'v1.2.1', column_from: 'backlog', column_to: 'backlog', note: 'Pindah ke backlog.' });
    expect(toTaskLog(odd).kind).toBe('note');
    const node = render(odd);
    expect(node.querySelector('.node__arrow')).toBeNull();
    expect(flat(node.querySelector('.node__note p')!)).toBe('Ren Owner Pindah ke backlog.');
    for (const note of ['moved into batch v0.1', ' Moved into batch v0.1', 'Sudah Moved into batch v0.1', '']) {
      expect(toTaskLog(logRow({ column_from: 'backlog', column_to: 'backlog', note })).kind).toBe('note');
    }
    for (const note of ['Moved into batch v0.1', 'Moved into batch v10.12', 'Moved into batch v1.2 "Billing"']) {
      expect(toTaskLog(logRow({ column_from: 'backlog', column_to: 'backlog', note })).kind).toBe('adopt');
    }
  });

  it('reads an entry the API marks kind "batch_adopted" the same way, whatever its columns', () => {
    const row = logRow({ kind: 'batch_adopted', version: 'v0.1.1', column_from: null, column_to: 'backlog', note: 'Moved into batch v0.1' });
    expect(toTaskLog(row).kind).toBe('adopt');
    const node = render(row);
    expect(flat(node.querySelector('[data-testid="log-adopt"]')!)).toBe('Masuk batch v0.1');
    expect(node.querySelector('.node__arrow')).toBeNull();
    expect(flat(node)).not.toContain('Dibuat di');
    expect(flat(node)).not.toContain('Moved into batch');
  });

  it('shows a kind "note" entry as a plain note, with no move', () => {
    const row = logRow({ kind: 'note', column_from: 'review', column_to: 'review', note: 'Tunggu konfirmasi klien.' });
    expect(toTaskLog(row).kind).toBe('note');
    const node = render(row);
    expect(node.querySelector('[data-testid="log-adopt"]')).toBeNull();
    expect(node.querySelector('.node__arrow')).toBeNull();
    expect(node.querySelector('.blk')).toBeNull();
    expect(flat(node)).not.toContain('Dibuat di');
    expect(flat(node.querySelector('.node__note p')!)).toBe('Ren Owner Tunggu konfirmasi klien.');
  });

  it('trusts a kind the API sends over the columns, so a "moved" entry stays a move', () => {
    const row = logRow({ kind: 'moved', column_from: 'backlog', column_to: 'ongoing', note: 'Mulai dikerjakan.' });
    expect(toTaskLog(row).kind).toBe('move');
    expect(render(row).querySelector('.node__arrow')).not.toBeNull();
  });

  it('keeps a real move as from → to with its note, and a creation as "Dibuat di"', () => {
    const moved = logRow({ column_from: 'backlog', column_to: 'ongoing', note: 'Mulai dikerjakan.' });
    expect(toTaskLog(moved).kind).toBe('move');
    const node = render(moved);
    expect(node.querySelector('[data-testid="log-adopt"]')).toBeNull();
    expect(node.querySelector('.node__arrow')).not.toBeNull();
    expect(flat(node)).toContain('Mulai dikerjakan.');

    app?.unmount();
    host?.remove();
    const created = render(logRow({ column_from: null, column_to: 'backlog', note: 'Task dibuat.' }));
    expect(flat(created)).toContain('Dibuat di');
    expect(created.querySelector('[data-testid="log-adopt"]')).toBeNull();
  });
});
