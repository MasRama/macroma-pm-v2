import type { BatchVersion, StatusCounts, TaskStatus, TaskVersion } from './view';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ongoing: 'On going',
  revisi: 'Revisi',
  review: 'Review',
  done: 'Done',
};

/** Solid status colour (blocks, column heads). */
export const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'var(--c-backlog)',
  ongoing: 'var(--c-ongoing)',
  revisi: 'var(--c-revisi)',
  review: 'var(--c-review)',
  done: 'var(--c-done)',
};

/** Bar and legend colour (Backlog bars are a shade lighter than its block). */
export const STATUS_BAR_COLOR: Record<TaskStatus, string> = { ...STATUS_COLOR, backlog: 'var(--c-backlog-bar)' };

const PROJECT_COLORS = ['var(--c-ongoing)', 'var(--c-done)', 'var(--c-revisi)', 'var(--c-review)', 'var(--c-gold)'];

/** The project colour square: picked from the project id, the API stores no colour. */
export function projectColor(id: string | number): string {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!;
}

export function formatVersion(version: BatchVersion | TaskVersion): string {
  const base = `v${version.major}.${version.minor}`;
  return 'patch' in version ? `${base}.${version.patch}` : base;
}

export function totalCount(counts: StatusCounts): number {
  return counts.backlog + counts.ongoing + counts.revisi + counts.review + counts.done;
}

/** Greeting for the dashboard title by local hour: Pagi, Siang, Sore, Malam. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 11) return 'Pagi';
  if (hour < 15) return 'Siang';
  if (hour < 18) return 'Sore';
  return 'Malam';
}
