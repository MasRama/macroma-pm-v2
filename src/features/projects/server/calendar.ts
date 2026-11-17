/**
 * Calendar days and weeks in the application's time zone (`APP_TIMEZONE`),
 * whatever zone the server process runs in. Weeks start on Monday.
 */

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** The wall-clock time in the zone at `at`, read as if it were UTC. */
function wallClock(at: number, timeZone: string): number {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

/** The zone's calendar date `offset` days after `date` (normalized, so month ends roll over). */
function shift(date: CalendarDate, offset: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The instant the date's midnight falls on in the zone. */
function startOfDay(date: CalendarDate, timeZone: string): number {
  const midnight = Date.UTC(date.year, date.month - 1, date.day);
  // Two passes settle the offset on days whose offset changes (daylight saving).
  let instant = midnight - (wallClock(midnight, timeZone) - midnight);
  instant = midnight - (wallClock(instant, timeZone) - instant);
  return instant;
}

function isoDay(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export interface DashboardCalendar {
  /** The last `days` days, oldest first and today last: each as `YYYY-MM-DD` with its last millisecond. */
  days: Array<{ day: string; end: number }>;
  /** When this week (Monday 00:00) began. */
  weekStart: number;
  /** When last week began. */
  lastWeekStart: number;
}

/** The days and weeks the dashboard counts over at `now`, in `timeZone`. */
export function dashboardCalendar(now: number, timeZone: string, days = 7): DashboardCalendar {
  const wall = new Date(wallClock(now, timeZone));
  const today: CalendarDate = { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
  const sinceMonday = (wall.getUTCDay() + 6) % 7;
  return {
    days: Array.from({ length: days }, (_, index) => {
      const date = shift(today, index - (days - 1));
      return { day: isoDay(date), end: startOfDay(shift(date, 1), timeZone) - 1 };
    }),
    weekStart: startOfDay(shift(today, -sinceMonday), timeZone),
    lastWeekStart: startOfDay(shift(today, -sinceMonday - 7), timeZone),
  };
}
