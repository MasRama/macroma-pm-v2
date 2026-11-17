import { describe, expect, it } from 'vitest';
import { projectsResponseSchemas } from '../contract';
import { toActiveRelease, toRelease, toReleaseDetail } from '../web/view';

const DAY = 24 * 60 * 60 * 1000;
const opened = Date.UTC(2026, 9, 14, 2);
const closed = opened + 20 * DAY;
const counts = { backlog: 1, ongoing: 2, revisi: 0, review: 1, done: 5 };

const releases = {
  success: true as const,
  message: 'Releases loaded.',
  data: {
    active: { id: 'b3', major: 2, minor: 3, label: 'Pairing flow', opened_at: closed, counts, total: 9, done: 5, progress: 56 },
    closed: [{ id: 'b2', major: 2, minor: 2, label: null, opened_at: opened, closed_at: closed, task_count: 18, major_bump: false }],
    upcoming: [],
  },
};

const detail = (batch: Record<string, unknown>, durationDays: number | null) => ({
  success: true as const,
  message: 'Release loaded.',
  data: {
    batch: { id: 'b2', major: 2, minor: 2, label: 'Billing & invoice', created_at: opened, opened_at: opened, closed_at: closed, task_count: 2, major_bump: true, is_active: false, ...batch },
    stats: { task_count: 2, duration_days: durationDays, revisi_task_count: 1 },
    changelog: [
      { task_id: 't1', title: 'Invoice PDF', priority: 'high', version: { major: 2, minor: 2, patch: 9 }, assignee: { id: 'u1', name: 'Azka', avatar: null }, column_id: 'done' },
      { task_id: 't2', title: 'Kupon diskon', priority: 'low', version: { major: 2, minor: 2, patch: 3 }, assignee: null, column_id: 'revisi' },
    ],
    contributors: [{ user: { id: 'u1', name: '', email: 'azka@wajom.co', avatar: null }, task_count: 2 }],
  },
});

describe('the Rilis view model', () => {
  it('maps the releases view: the active batch for the ink block and the closed ones for SUDAH RILIS', () => {
    // The fixtures are the shapes the API promises, so these tests break when those shapes drift.
    const parsed = projectsResponseSchemas().releases.parse(releases);
    expect(toActiveRelease(parsed.data.active!)).toEqual({
      id: 'b3',
      major: 2,
      minor: 3,
      label: 'Pairing flow',
      openedAt: new Date(closed).toISOString(),
      isActive: true,
      counts,
    });
    expect(parsed.data.closed.map(toRelease)).toEqual([
      {
        id: 'b2',
        major: 2,
        minor: 2,
        label: '',
        openedAt: new Date(opened).toISOString(),
        closedAt: new Date(closed).toISOString(),
        taskCount: 18,
        isMajor: false,
      },
    ]);
  });

  it('maps a closed release with its numbers, changelog statuses and contributors', () => {
    const parsed = projectsResponseSchemas().releaseDetail.parse(detail({}, 20));
    expect(toReleaseDetail(parsed.data)).toEqual({
      id: 'b2',
      major: 2,
      minor: 2,
      label: 'Billing & invoice',
      openedAt: new Date(opened).toISOString(),
      closedAt: new Date(closed).toISOString(),
      taskCount: 2,
      isMajor: true,
      isActive: false,
      durationDays: 20,
      revisiTaskCount: 1,
      changelog: [
        { id: 't1', title: 'Invoice PDF', priority: 'high', version: { major: 2, minor: 2, patch: 9 }, assignee: { id: 'u1', name: 'Azka', avatar: null }, status: 'done' },
        { id: 't2', title: 'Kupon diskon', priority: 'low', version: { major: 2, minor: 2, patch: 3 }, assignee: null, status: 'revisi' },
      ],
      // An account without a name is shown by its email.
      contributors: [{ person: { id: 'u1', name: 'azka@wajom.co', avatar: null }, taskCount: 2 }],
    });
  });

  it('keeps an active release open: no closing date and no duration yet', () => {
    const parsed = projectsResponseSchemas().releaseDetail.parse(detail({ closed_at: null, is_active: true }, null));
    expect(toReleaseDetail(parsed.data)).toMatchObject({ closedAt: null, isActive: true, durationDays: null });
  });
});
