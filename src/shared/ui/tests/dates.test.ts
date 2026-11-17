import { describe, expect, it } from 'vitest';
import { formatAgo, formatAgoLong, formatDayLabel, formatStamp } from '../dates';

const now = new Date('2026-11-17T10:20:00');

describe('Indonesian date labels', () => {
  it('stamps a version log entry with weekday, day and time', () => {
    expect(formatStamp('2026-11-17T10:12:00')).toBe('Sel 17 Nov, 10.12');
  });

  it('gives feeds a short relative time', () => {
    expect(formatAgo('2026-11-17T10:08:00', now)).toBe('12 mnt');
    expect(formatAgo('2026-11-17T08:20:00', now)).toBe('2 jam');
    expect(formatAgo('2026-11-16T09:00:00', now)).toBe('Kemarin');
    expect(formatAgo('2026-11-04T14:00:00', now)).toBe('4 Nov');
  });

  it('counts days for notifications and invitations within a week', () => {
    expect(formatAgoLong('2026-11-17T10:15:00', now)).toBe('5 menit lalu');
    expect(formatAgoLong('2026-11-17T09:20:00', now)).toBe('1 jam lalu');
    expect(formatAgoLong('2026-11-16T09:00:00', now)).toBe('Kemarin');
    expect(formatAgoLong('2026-11-15T10:20:00', now)).toBe('2 hari lalu');
    expect(formatAgoLong('2026-11-04T14:00:00', now)).toBe('4 Nov');
  });

  it('labels chat days', () => {
    expect(formatDayLabel('2026-11-17T09:41:00', now)).toBe('Hari ini');
    expect(formatDayLabel('2026-11-16T23:00:00', now)).toBe('Kemarin');
    expect(formatDayLabel('2026-11-12T09:00:00', now)).toBe('12 Nov');
  });
});
