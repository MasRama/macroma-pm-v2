import { afterEach, describe, expect, it } from 'vitest';
import { dashboardCalendar } from '../server/calendar';

const serverZone = process.env.TZ;

/** Runs `compute` as a server in `zone` would; Node reads TZ again when it changes. */
function inServerZone<T>(zone: string, compute: () => T): T {
  process.env.TZ = zone;
  return compute();
}

describe('dashboard calendar', () => {
  afterEach(() => {
    if (serverZone === undefined) delete process.env.TZ;
    else process.env.TZ = serverZone;
  });

  it('counts the app time zone days and Monday weeks whatever zone the server runs in', () => {
    // Wednesday 18 November, 03:30 in Jakarta; still the 17th in UTC.
    const now = Date.parse('2026-11-17T20:30:00Z');
    const [utc, jakarta, losAngeles] = ['UTC', 'Asia/Jakarta', 'America/Los_Angeles'].map((zone) =>
      inServerZone(zone, () => dashboardCalendar(now, 'Asia/Jakarta')),
    );

    expect(jakarta).toEqual(utc);
    expect(losAngeles).toEqual(utc);
    expect(utc.days.map(({ day }) => day)).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
    ]);
    expect(utc.days[6].end).toBe(Date.parse('2026-11-18T16:59:59.999Z'));
    expect(utc.days[0].end).toBe(Date.parse('2026-11-12T16:59:59.999Z'));
    expect(utc.weekStart).toBe(Date.parse('2026-11-15T17:00:00Z'));
    expect(utc.lastWeekStart).toBe(Date.parse('2026-11-08T17:00:00Z'));
  });

  it('starts the week on the Monday itself and keeps day ends exact across daylight saving', () => {
    const monday = dashboardCalendar(Date.parse('2026-11-15T17:00:00Z'), 'Asia/Jakarta');
    expect(monday.days[6].day).toBe('2026-11-16');
    expect(monday.weekStart).toBe(Date.parse('2026-11-15T17:00:00Z'));

    // Amsterdam moves from +01:00 to +02:00 on Sunday 29 March 2026.
    const spring = inServerZone('UTC', () => dashboardCalendar(Date.parse('2026-03-30T10:00:00Z'), 'Europe/Amsterdam'));
    expect(spring.days.slice(-3)).toEqual([
      { day: '2026-03-28', end: Date.parse('2026-03-28T22:59:59.999Z') },
      { day: '2026-03-29', end: Date.parse('2026-03-29T21:59:59.999Z') },
      { day: '2026-03-30', end: Date.parse('2026-03-30T21:59:59.999Z') },
    ]);
    expect(spring.weekStart).toBe(Date.parse('2026-03-29T22:00:00Z'));
    expect(spring.lastWeekStart).toBe(Date.parse('2026-03-22T23:00:00Z'));
  });
});
