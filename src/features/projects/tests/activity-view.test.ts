import { describe, expect, it } from 'vitest';
import type { DashboardActivity } from '../contract';
import { toActivityEntry } from '../web/view';

function row(overrides: Partial<DashboardActivity>): DashboardActivity {
  return {
    id: 'a1',
    project_id: 'p1',
    event_type: 'task.moved',
    description: 'Task moved',
    actor: { id: 'u1', name: 'Azka', avatar: null },
    task_id: 't1',
    batch_id: 'b1',
    task_title: 'Checkout Midtrans gagal di Safari iOS',
    batch_version: null,
    meta: { from: 'review', to: 'revisi', version: 'v2.3.7' },
    created_at: Date.UTC(2026, 10, 17, 3, 8),
    ...overrides,
  };
}

describe('activity lines', () => {
  it('names the task a task event is about', () => {
    expect(toActivityEntry(row({}), 'Wajom Portal')).toMatchObject({
      kind: 'moved',
      subject: 'Wajom Portal',
      task: 'Checkout Midtrans gagal di Safari iOS',
      status: 'revisi',
      version: { major: 2, minor: 3, patch: 7 },
    });
  });

  it('falls back to the project for a row recorded without a task title', () => {
    expect(toActivityEntry(row({ task_title: null }), 'Wajom Portal')).toMatchObject({ subject: 'Wajom Portal', task: null });
  });

  it("gives a bump the batch's version, and none when the row has none", () => {
    const bump = { event_type: 'batch.activated', task_id: null, task_title: null, meta: null } as const;
    expect(toActivityEntry(row({ ...bump, batch_version: '1.8' }), 'Stoko App')).toMatchObject({ kind: 'bumped', version: { major: 1, minor: 8 } });
    expect(toActivityEntry(row({ ...bump, batch_version: null }), 'Stoko App')).toMatchObject({ kind: 'bumped', version: null });
  });
});
